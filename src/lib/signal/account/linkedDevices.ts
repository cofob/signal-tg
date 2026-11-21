import { create, toBinary } from '@bufbuild/protobuf';

import type { SenderContext } from '../sender/sendContent';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord } from '../store/SignalStore';

import { bufferFromBase64, bufferToBase64 } from '../../../util/encoding/buffer';
import { uuidToBytes } from '../serviceId';
import { wasm } from '../wasm';
import { decryptDeviceName } from './linkDevice';
import { encryptProvisionMessage } from './provisioning';

import { ProvisionMessageSchema } from '../proto/generated/Provisioning_pb';

export type LinkedDevice = {
  id: number;
  // Absent when the name does not decrypt
  name?: string;
  // Milliseconds since the epoch, with the precision of a day
  lastSeen: number;
};

export type DeviceLinkTarget = {
  // The address of the provisioning socket that the new device opened
  id: string;
  // The new device's serialized public key
  publicKey: Uint8Array;
};

export type DeviceLinkErrorReason =
  // The QR code or link is not one of a device to link
  | 'badCode'
  // The account is at the device limit
  | 'limitExceeded'
  // The new device lacks a capability this account needs, or its code expired
  | 'rejected'
  | 'rateLimited'
  // The account has no recovery key (account entropy pool), which the new device needs
  | 'noRecoveryKey'
  | 'network';

export class DeviceLinkError extends Error {
  constructor(readonly reason: DeviceLinkErrorReason) {
    super(`Linking a device failed: ${reason}`);
  }
}

type ServerDevice = {
  id: number;
  name?: string;
  lastSeen: number;
};

type DevicesResponse = {
  devices: ServerDevice[];
};

type VerificationCodeResponse = {
  verificationCode: string;
  tokenIdentifier: string;
};

type WaitForLinkedDeviceResponse = ServerDevice & { registrationId: number };

const LINK_DEVICE_HOST = 'linkdevice';
const LINK_DEVICE_SCHEME = 'sgnl:';
const WAIT_TIMEOUT_SECONDS = 30;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_LENGTH_REQUIRED = 411;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;
// The version of the format the new device reads (`ProvisioningVersion.CURRENT`)
const PROVISIONING_VERSION = 1;

/**
 * Reads the `sgnl://linkdevice?uuid=…&pub_key=…` link of a device that wants to be linked, as Signal Android
 * `LinkDeviceRepository.isValidQr` and `parsePublicKey` do: the key is standard or URL-safe base64, with or
 * without padding. Returns `undefined` for anything else.
 */
export function parseDeviceLinkUrl(link: string): DeviceLinkTarget | undefined {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== LINK_DEVICE_SCHEME || url.hostname !== LINK_DEVICE_HOST) return undefined;

  const id = url.searchParams.get('uuid');
  // A `+` in a key that was not percent-encoded reads as a space
  const encodedKey = url.searchParams.get('pub_key')?.replace(/ /g, '+');
  if (!id || !encodedKey) return undefined;

  try {
    const publicKey = bufferFromBase64(encodedKey.replace(/-/g, '+').replace(/_/g, '/'));
    wasm.PublicKey_Deserialize(publicKey);
    return { id, publicKey };
  } catch {
    return undefined;
  }
}

/** The devices of the account, ours included, as the server lists them (`GET /v1/devices`) */
export async function fetchLinkedDevices(
  { connection, store }: Pick<SenderContext, 'connection' | 'store'>,
): Promise<LinkedDevice[]> {
  const { status, json } = await connection.sendJsonRequest<DevicesResponse>('GET', '/v1/devices');
  if (status !== HTTP_OK || !json) throw new Error(`Device list request failed with HTTP ${status}`);

  const identityKeyPair = await store.getItem('aciIdentityKeyPair');
  const names = await Promise.all(json.devices.map(async ({ name }) => (
    name && identityKeyPair ? decryptDeviceName(name, identityKeyPair.privateKey).catch(() => undefined) : undefined
  )));
  return json.devices.map(({ id, lastSeen }, index) => ({ id, name: names[index], lastSeen }));
}

/** Unlinks a device, which then cannot connect any more (`DELETE /v1/devices/{id}`) */
export async function removeLinkedDevice({ connection }: Pick<SenderContext, 'connection'>, deviceId: number) {
  const { status } = await connection.sendJsonRequest('DELETE', `/v1/devices/${deviceId}`);
  if (status !== HTTP_OK && status !== HTTP_NO_CONTENT) throw new Error(`Unlinking failed with HTTP ${status}`);
}

/**
 * Links the device behind a QR code to our account from a primary device: asks for a verification code, sends
 * the new device the account keys in an encrypted provisioning message, and waits for it to register (Signal
 * Android `LinkDeviceRepository.addDevice` and `LinkDeviceApi.linkDevice`, Signal Desktop has no primary role).
 * The new device syncs messages and contacts from the storage service, and our configuration and blocked list
 * from sync requests. Resolves with the new device, or `undefined` when it did not register in time.
 */
export async function addLinkedDevice(
  { store, account, connection }: Pick<SenderContext, 'store' | 'account' | 'connection'>,
  target: DeviceLinkTarget,
): Promise<LinkedDevice | undefined> {
  if (!account.accountEntropyPool) throw new DeviceLinkError('noRecoveryKey');
  const codeResponse = await connection.sendJsonRequest<VerificationCodeResponse>(
    'GET', '/v1/devices/provisioning/code',
  );
  throwLinkError(codeResponse.status);
  if (!codeResponse.json) throw new Error('Verification code response is empty');
  const { verificationCode, tokenIdentifier } = codeResponse.json;

  const message = await buildProvisionMessage(store, account, verificationCode);
  const body = bufferToBase64(await encryptProvisionMessage(target.publicKey, message));
  const { status } = await connection.sendJsonRequest(
    'PUT', `/v1/provisioning/${encodeURIComponent(target.id)}`, { body },
  );
  throwLinkError(status);

  return waitForLinkedDevice(connection, tokenIdentifier, store);
}

/** The provisioning message of the account, with the phone number data only as a complete set */
export async function buildProvisionMessage(store: SignalStore, account: AccountRecord, code: string) {
  const aciIdentityKeyPair = (await store.getItem('aciIdentityKeyPair'))!;
  const pniIdentityKeyPair = await store.getItem('pniIdentityKeyPair');
  const hasPhoneNumber = Boolean(account.number && account.pni && pniIdentityKeyPair);

  return toBinary(ProvisionMessageSchema, create(ProvisionMessageSchema, {
    aciIdentityKeyPublic: aciIdentityKeyPair.publicKey,
    aciIdentityKeyPrivate: aciIdentityKeyPair.privateKey,
    pniIdentityKeyPublic: hasPhoneNumber ? pniIdentityKeyPair!.publicKey : undefined,
    pniIdentityKeyPrivate: hasPhoneNumber ? pniIdentityKeyPair!.privateKey : undefined,
    aci: account.aci,
    aciBinary: uuidToBytes(account.aci),
    pni: hasPhoneNumber ? account.pni : undefined,
    pniBinary: hasPhoneNumber ? uuidToBytes(account.pni!) : undefined,
    number: hasPhoneNumber ? account.number : undefined,
    provisioningCode: code,
    profileKey: account.profileKey,
    readReceipts: account.isReadReceiptsEnabled,
    provisioningVersion: PROVISIONING_VERSION,
    accountEntropyPool: account.accountEntropyPool,
    mediaRootBackupKey: account.mediaRootBackupKey,
    authCredentialSalt: account.authCredentialSalt,
  }));
}

/** Waits up to 30 seconds for the device to register with the code we gave it */
async function waitForLinkedDevice(
  connection: SenderContext['connection'], token: string, store: SignalStore,
): Promise<LinkedDevice | undefined> {
  const { status, json } = await connection.sendJsonRequest<WaitForLinkedDeviceResponse>(
    'GET', `/v1/devices/wait_for_linked_device/${encodeURIComponent(token)}?timeout=${WAIT_TIMEOUT_SECONDS}`,
  );
  if (status === HTTP_NO_CONTENT || !json) return undefined;
  if (status !== HTTP_OK) throw new Error(`Waiting for the device failed with HTTP ${status}`);

  const identityKeyPair = await store.getItem('aciIdentityKeyPair');
  const name = json.name && identityKeyPair
    ? await decryptDeviceName(json.name, identityKeyPair.privateKey).catch(() => undefined)
    : undefined;
  return { id: json.id, name, lastSeen: json.lastSeen };
}

function throwLinkError(status: number) {
  if (status === HTTP_OK || status === HTTP_NO_CONTENT) return;
  if (status === HTTP_LENGTH_REQUIRED) throw new DeviceLinkError('limitExceeded');
  if (status === HTTP_TOO_MANY_REQUESTS) throw new DeviceLinkError('rateLimited');
  if (status === HTTP_FORBIDDEN || status === HTTP_CONFLICT || status === HTTP_UNPROCESSABLE) {
    throw new DeviceLinkError('rejected');
  }
  throw new Error(`Linking a device failed with HTTP ${status}`);
}
