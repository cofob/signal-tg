import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type ChatConnection from '../chat/ChatConnection';
import type { ProtocolStores } from '../store/protocolStores';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord } from '../store/SignalStore';

import { bufferFromBase64, bufferToBase64 } from '../../../util/encoding/buffer';
import { padMessage } from '../crypto';
import { createProtocolStores } from '../store/protocolStores';
import { wasm } from '../wasm';

import { ContentSchema, Envelope_Type } from '../proto/generated/SignalService_pb';

export type SenderContext = {
  store: SignalStore;
  account: AccountRecord;
  connection: ChatConnection;
};

type SendOptions = {
  timestamp: number;
  isOnline?: boolean;
  isUrgent?: boolean;
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

const MAX_SEND_ATTEMPTS = 3;
const HTTP_OK = 200;
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
 * Encrypts `content` to every device of `destination` with an identified (non-sealed) envelope and sends it,
 * fixing the device list from 409/410 responses (Signal Desktop `OutgoingMessage`).
 * When `destination` is our ACI, the content goes to our other devices only.
 */
export async function sendContent(
  context: SenderContext, destination: string, content: MessageInitShape<typeof ContentSchema>, options: SendOptions,
) {
  const { store, account, connection } = context;
  const keyPair = await store.getItem('aciIdentityKeyPair');
  if (!keyPair) throw new Error('ACI identity key is missing');

  const stores = createProtocolStores(store, {
    serviceId: account.aci, keyPair, registrationId: account.registrationId,
  });
  const localAddress = wasm.ProtocolAddress_New(account.aci, account.deviceId);
  const plaintext = padMessage(toBinary(ContentSchema, create(ContentSchema, content)));
  const isToSelf = destination === account.aci;

  let deviceIds = await getDeviceIds(store, destination, account, isToSelf);
  if (!deviceIds.length && !isToSelf) {
    deviceIds = await fetchSessions(context, stores, localAddress, destination, '*');
  }

  for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt++) {
    const messages = [];
    for (const deviceId of deviceIds) {
      const address = wasm.ProtocolAddress_New(destination, deviceId);
      const ciphertext = await wasm.SessionCipher_EncryptMessage(
        plaintext, address, localAddress, stores.session, stores.identity, Date.now(),
      ) as wasm.CiphertextMessage;
      const session = wasm.SessionRecord_Deserialize((await store.getSession(`${destination}.${deviceId}`))!);
      messages.push({
        type: wasm.CiphertextMessage_Type(ciphertext) === MESSAGE_TYPE_PREKEY
          ? Envelope_Type.PREKEY_MESSAGE
          : Envelope_Type.DOUBLE_RATCHET,
        destinationDeviceId: deviceId,
        destinationRegistrationId: wasm.SessionRecord_GetRemoteRegistrationId(session),
        content: bufferToBase64(wasm.CiphertextMessage_Serialize(ciphertext)),
      });
    }

    const { status, json } = await connection.sendJsonRequest<MismatchedDevices & StaleDevices>(
      'PUT',
      `/v1/messages/${destination}?story=false`,
      {
        messages,
        timestamp: options.timestamp,
        online: options.isOnline ?? false,
        urgent: options.isUrgent ?? true,
      },
    );

    if (status === HTTP_OK) return;
    if (status === HTTP_NOT_FOUND) throw new UnregisteredUserError(destination);

    if (status === HTTP_CONFLICT) {
      for (const deviceId of json?.extraDevices ?? []) {
        await store.removeSession(`${destination}.${deviceId}`);
      }
      for (const deviceId of json?.missingDevices ?? []) {
        await fetchSessions(context, stores, localAddress, destination, String(deviceId));
      }
    } else if (status === HTTP_GONE) {
      for (const deviceId of json?.staleDevices ?? []) {
        await store.removeSession(`${destination}.${deviceId}`);
        await fetchSessions(context, stores, localAddress, destination, String(deviceId));
      }
    } else {
      throw new Error(`Sending to ${destination} failed with HTTP ${status}`);
    }

    deviceIds = await getDeviceIds(store, destination, account, isToSelf);
  }

  throw new Error(`Sending to ${destination} failed: the device list kept changing`);
}

async function getDeviceIds(store: SignalStore, destination: string, account: AccountRecord, isToSelf: boolean) {
  const deviceIds = await store.getSessionDeviceIds(destination);
  return isToSelf ? deviceIds.filter((deviceId) => deviceId !== account.deviceId) : deviceIds;
}

/** Fetches prekey bundles (`GET /v2/keys`) and starts sessions; returns the device ids it started */
async function fetchSessions(
  { connection }: SenderContext,
  stores: ProtocolStores,
  localAddress: wasm.ProtocolAddress,
  destination: string,
  deviceSpecifier: string,
) {
  const { status, json } = await connection.sendJsonRequest<PreKeyResponse>(
    'GET', `/v2/keys/${destination}/${deviceSpecifier}`,
  );
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
