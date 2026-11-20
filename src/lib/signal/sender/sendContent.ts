import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type ChatConnection from '../chat/ChatConnection';
import type UnauthenticatedChat from '../chat/UnauthenticatedChat';
import type { ProtocolStores } from '../store/protocolStores';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord } from '../store/SignalStore';

import { bufferFromBase64, bufferToBase64 } from '../../../util/encoding/buffer';
import { padMessage } from '../crypto';
import { createProtocolStores } from '../store/protocolStores';
import { wasm } from '../wasm';
import { getAccessKey, getSenderCertificate } from './sealedSender';

import { ContentSchema, Envelope_Type } from '../proto/generated/SignalService_pb';

export type SenderContext = {
  store: SignalStore;
  account: AccountRecord;
  connection: ChatConnection;
  unauthenticatedChat: UnauthenticatedChat;
};

/** `ContentHint` of libsignal: whether the recipient may ask for a resend after a decryption error */
export enum ContentHint {
  Default = 0,
  Resendable = 1,
  Implicit = 2,
}

type SendOptions = {
  timestamp: number;
  isOnline?: boolean;
  isUrgent?: boolean;
  contentHint?: ContentHint;
  // Group id that sealed sender envelopes of group messages carry
  groupId?: Uint8Array;
};

export type SendResult = {
  isSealedSender: boolean;
};

type PreKeyResponse = {
  identityKey: string;
  devices: {
    deviceId: number;
    registrationId: number;
    signedPreKey: { keyId: number; publicKey: string; signature: string };
    preKey?: { keyId: number; publicKey: string };
    pqPreKey: { keyId: number; publicKey: string; signature: string };
  }[];
};

type MismatchedDevices = { missingDevices?: number[]; extraDevices?: number[] };
type StaleDevices = { staleDevices?: number[] };

type SendState = {
  context: SenderContext;
  stores: ProtocolStores;
  localAddress: wasm.ProtocolAddress;
  destination: string;
  // Cleared when the server rejects it; the send then continues identified
  accessKey?: string;
};

const MAX_DEVICE_LIST_ATTEMPTS = 3;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
// `CiphertextMessageType.PreKey` in libsignal
const MESSAGE_TYPE_PREKEY = 3;

export class UnregisteredUserError extends Error {
  constructor(readonly serviceId: string) {
    super(`${serviceId} is not a registered Signal user`);
  }
}

/**
 * Encrypts `content` to every device of `destination` and sends it, fixing the device list from 409/410
 * responses (Signal Desktop `ts/textsecure/OutgoingMessage.preload.ts`). Messages to other users go
 * sealed sender over the unauthenticated socket when the recipient allows it, and identified otherwise.
 * When `destination` is our ACI, the content goes identified to our other devices only.
 */
export async function sendContent(
  context: SenderContext, destination: string, content: MessageInitShape<typeof ContentSchema>, options: SendOptions,
): Promise<SendResult> {
  const { store, account } = context;
  const keyPair = await store.getItem('aciIdentityKeyPair');
  if (!keyPair) throw new Error('ACI identity key is missing');

  const isToSelf = destination === account.aci;
  const state: SendState = {
    context,
    stores: createProtocolStores(store, { serviceId: account.aci, keyPair, registrationId: account.registrationId }),
    localAddress: wasm.ProtocolAddress_New(account.aci, account.deviceId),
    destination,
    accessKey: isToSelf ? undefined : await getAccessKey(store, destination),
  };
  const plaintext = padMessage(toBinary(ContentSchema, create(ContentSchema, content)));

  let deviceIds = await getDeviceIds(store, destination, account, isToSelf);
  if (!deviceIds.length && !isToSelf) {
    deviceIds = await fetchSessions(state, '*');
  }

  let deviceListAttempts = 0;
  while (deviceListAttempts < MAX_DEVICE_LIST_ATTEMPTS) {
    const isSealedSender = Boolean(state.accessKey);
    const messages = await encryptForDevices(state, plaintext, deviceIds, options);
    const path = `/v1/messages/${destination}?story=false`;
    const body = {
      messages,
      timestamp: options.timestamp,
      online: options.isOnline ?? false,
      urgent: options.isUrgent ?? true,
    };
    const { status, json } = state.accessKey
      ? await context.unauthenticatedChat.sendJsonRequest<MismatchedDevices & StaleDevices>(
        'PUT', path, body, { 'Unidentified-Access-Key': state.accessKey },
      )
      : await context.connection.sendJsonRequest<MismatchedDevices & StaleDevices>('PUT', path, body);

    if (status === HTTP_OK) return { isSealedSender };
    if (status === HTTP_NOT_FOUND) throw new UnregisteredUserError(destination);

    if (status === HTTP_UNAUTHORIZED && state.accessKey) {
      await rejectAccessKey(state);
      continue;
    }

    if (status === HTTP_CONFLICT) {
      for (const deviceId of json?.extraDevices ?? []) {
        await store.removeSession(`${destination}.${deviceId}`);
      }
      for (const deviceId of json?.missingDevices ?? []) {
        await fetchSessions(state, String(deviceId));
      }
    } else if (status === HTTP_GONE) {
      for (const deviceId of json?.staleDevices ?? []) {
        await store.removeSession(`${destination}.${deviceId}`);
        await fetchSessions(state, String(deviceId));
      }
    } else {
      throw new Error(`Sending to ${destination} failed with HTTP ${status}`);
    }

    deviceIds = await getDeviceIds(store, destination, account, isToSelf);
    deviceListAttempts++;
  }

  throw new Error(`Sending to ${destination} failed: the device list kept changing`);
}

async function encryptForDevices(
  state: SendState, plaintext: Uint8Array, deviceIds: number[], options: SendOptions,
) {
  const { context: { store, connection }, stores, localAddress, destination } = state;
  const certificate = state.accessKey ? await getSenderCertificate(store, connection) : undefined;

  const messages = [];
  for (const deviceId of deviceIds) {
    const address = wasm.ProtocolAddress_New(destination, deviceId);
    const ciphertext = await wasm.SessionCipher_EncryptMessage(
      plaintext, address, localAddress, stores.session, stores.identity, Date.now(),
    ) as wasm.CiphertextMessage;
    const session = wasm.SessionRecord_Deserialize((await store.getSession(`${destination}.${deviceId}`))!);
    const destinationRegistrationId = wasm.SessionRecord_GetRemoteRegistrationId(session);

    if (certificate) {
      const usmc = wasm.UnidentifiedSenderMessageContent_New(
        ciphertext, certificate, options.contentHint ?? ContentHint.Default, options.groupId,
      );
      const sealed = await wasm.SealedSender_Encrypt(address, usmc, stores.identity) as Uint8Array;
      messages.push({
        type: Envelope_Type.UNIDENTIFIED_SENDER,
        destinationDeviceId: deviceId,
        destinationRegistrationId,
        content: bufferToBase64(sealed),
      });
      continue;
    }

    messages.push({
      type: wasm.CiphertextMessage_Type(ciphertext) === MESSAGE_TYPE_PREKEY
        ? Envelope_Type.PREKEY_MESSAGE
        : Envelope_Type.DOUBLE_RATCHET,
      destinationDeviceId: deviceId,
      destinationRegistrationId,
      content: bufferToBase64(wasm.CiphertextMessage_Serialize(ciphertext)),
    });
  }
  return messages;
}

/** The recipient does not accept our access key: send identified from now on */
async function rejectAccessKey(state: SendState) {
  state.accessKey = undefined;
  await state.context.store.updateRecipient(state.destination, { sealedSender: 'disabled' });
}

async function getDeviceIds(store: SignalStore, destination: string, account: AccountRecord, isToSelf: boolean) {
  const deviceIds = await store.getSessionDeviceIds(destination);
  return isToSelf ? deviceIds.filter((deviceId) => deviceId !== account.deviceId) : deviceIds;
}

/**
 * Fetches prekey bundles (`GET /v2/keys`) and starts sessions; returns the device ids it started.
 * With an access key the request goes unauthenticated, so the server does not learn who asks.
 */
async function fetchSessions(state: SendState, deviceSpecifier: string) {
  const { context: { connection, unauthenticatedChat }, stores, localAddress, destination } = state;
  const path = `/v2/keys/${destination}/${deviceSpecifier}`;

  let response = state.accessKey
    ? await unauthenticatedChat.sendJsonRequest<PreKeyResponse>(
      'GET', path, undefined, { 'Unidentified-Access-Key': state.accessKey },
    )
    : undefined;
  if (response?.status === HTTP_UNAUTHORIZED) await rejectAccessKey(state);
  if (!response || response.status === HTTP_UNAUTHORIZED) {
    response = await connection.sendJsonRequest<PreKeyResponse>('GET', path);
  }

  const { status, json } = response;
  if (status === HTTP_NOT_FOUND) throw new UnregisteredUserError(destination);
  if (status !== HTTP_OK || !json) throw new Error(`Fetching prekeys of ${destination} failed with HTTP ${status}`);

  const identityKey = wasm.PublicKey_Deserialize(bufferFromBase64(json.identityKey));
  const deviceIds: number[] = [];
  for (const device of json.devices) {
    const preKey = device.preKey
      ? wasm.PublicKey_Deserialize(bufferFromBase64(device.preKey.publicKey))
      : undefined;
    const bundle = wasm.PreKeyBundle_New(
      device.registrationId,
      device.deviceId,
      device.preKey?.keyId,
      preKey,
      device.signedPreKey.keyId,
      wasm.PublicKey_Deserialize(bufferFromBase64(device.signedPreKey.publicKey)),
      bufferFromBase64(device.signedPreKey.signature),
      identityKey,
      device.pqPreKey.keyId,
      wasm.KyberPublicKey_Deserialize(bufferFromBase64(device.pqPreKey.publicKey)),
      bufferFromBase64(device.pqPreKey.signature),
    );
    await wasm.SessionBuilder_ProcessPreKeyBundle(
      bundle,
      wasm.ProtocolAddress_New(destination, device.deviceId),
      localAddress,
      stores.session,
      stores.identity,
      Date.now(),
    );
    deviceIds.push(device.deviceId);
  }
  return deviceIds;
}
