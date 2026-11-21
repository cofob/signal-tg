import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type { ProvisionMessage } from '../proto/generated/Provisioning_pb';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord, KeyPairBytes } from '../store/SignalStore';

import { SIGNAL_CHAT_HOST } from '../config';
import { bufferFromBase64, buffersEqual, bufferToBase64 } from '../../../util/encoding/buffer';
import {
  encodeUtf8, encryptAesCtr, generateRegistrationId, getRandomBytes, hmacSha256,
} from '../crypto';
import { HttpError, sendJsonRequest } from '../net/rest';
import { toPniServiceId, uuidToString } from '../serviceId';
import { wasm } from '../wasm';
import { getDeviceCapabilities } from './capabilities';
import { generateKyberPreKeys, generateSignedPreKey, uploadOneTimePreKeys } from './preKeys';

import { DeviceNameSchema } from '../proto/generated/DeviceName_pb';

type LinkDeviceResponse = {
  uuid: string;
  pni?: string;
  deviceId: number;
};

const PASSWORD_BYTES = 16;
const SYNTHETIC_IV_LENGTH = 16;
const AES_COUNTER_LENGTH = 16;
const HTTP_UNAUTHORIZED = 401;

/**
 * Registers this browser as a linked device with the keys from the primary device's provisioning message
 * (Signal Desktop `AccountManager.createAccount` and `WebAPI.linkDevice`).
 */
export async function linkDevice(store: SignalStore, message: ProvisionMessage, deviceName: string) {
  const aci = message.aciBinary.length ? uuidToString(message.aciBinary) : message.aci;
  const pni = message.pniBinary.length ? uuidToString(message.pniBinary) : message.pni;
  if (!aci || !message.aciIdentityKeyPrivate.length || !message.provisioningCode) {
    throw new Error('Provisioning message is incomplete');
  }

  // Accounts without a phone number have no PNI; their group credentials need the auth credential salt instead
  const hasPni = Boolean(pni);
  if (hasPni && (!message.number || !message.pniIdentityKeyPrivate.length)) {
    throw new Error('Provisioning message has a PNI without a phone number or PNI identity key');
  }
  if (!hasPni && !message.authCredentialSalt.length) {
    throw new Error('Provisioning message of an account without a phone number has no auth credential salt');
  }

  const aciIdentityKeyPair = getKeyPair(message.aciIdentityKeyPrivate);
  const pniIdentityKeyPair = hasPni ? getKeyPair(message.pniIdentityKeyPrivate) : undefined;
  const pniServiceId = hasPni ? toPniServiceId(pni) : undefined;

  // The base64 of 16 random bytes without its `==` padding
  const password = bufferToBase64(getRandomBytes(PASSWORD_BYTES)).slice(0, -2);
  const registrationId = generateRegistrationId();
  const pniRegistrationId = generateRegistrationId();

  const aciSignedPreKey = await generateSignedPreKey(store, aci, aciIdentityKeyPair);
  const [aciPqLastResortPreKey] = await generateKyberPreKeys(store, aci, aciIdentityKeyPair, 1, true);
  const pniSignedPreKey = hasPni
    ? await generateSignedPreKey(store, pniServiceId!, pniIdentityKeyPair!)
    : undefined;
  const pniPqLastResortPreKey = hasPni
    ? (await generateKyberPreKeys(store, pniServiceId!, pniIdentityKeyPair!, 1, true))[0]
    : undefined;

  const response = await sendJsonRequest<LinkDeviceResponse>(SIGNAL_CHAT_HOST, {
    method: 'PUT',
    path: '/v1/devices/link',
    credentials: { username: aci, password },
    json: {
      verificationCode: message.provisioningCode,
      accountAttributes: {
        fetchesMessages: true,
        name: await encryptDeviceName(deviceName, aciIdentityKeyPair.publicKey),
        registrationId,
        pniRegistrationId: hasPni ? pniRegistrationId : undefined,
        capabilities: getDeviceCapabilities(hasPni),
      },
      aciSignedPreKey,
      aciPqLastResortPreKey,
      pniSignedPreKey,
      pniPqLastResortPreKey,
    },
  });
  if (!response) throw new Error('Empty response to device link');

  const account: AccountRecord = {
    aci,
    pni: hasPni ? pni : undefined,
    number: hasPni ? message.number : undefined,
    deviceId: response.deviceId,
    deviceName,
    password,
    registrationId,
    pniRegistrationId,
    profileKey: getOptionalBytes(message.profileKey),
    accountEntropyPool: message.accountEntropyPool || undefined,
    mediaRootBackupKey: getOptionalBytes(message.mediaRootBackupKey),
    ephemeralBackupKey: getOptionalBytes(message.ephemeralBackupKey),
    // The primary device sends the key when the user chose to transfer message history
    historyTransfer: message.ephemeralBackupKey.length ? {} : undefined,
    authCredentialSalt: getOptionalBytes(message.authCredentialSalt),
    isReadReceiptsEnabled: message.readReceipts,
  };
  await store.setItem('aciIdentityKeyPair', aciIdentityKeyPair);
  if (hasPni) await store.setItem('pniIdentityKeyPair', pniIdentityKeyPair!);
  await store.setItem('account', account);

  const credentials = getAccountCredentials(account);
  await uploadOneTimePreKeys(store, credentials, 'aci', aci, aciIdentityKeyPair);
  if (hasPni) await uploadOneTimePreKeys(store, credentials, 'pni', pniServiceId!, pniIdentityKeyPair!);

  return account;
}

/** Removes this device from the account (`DELETE /v1/devices/{id}`); linked devices may remove only themselves */
export async function unlinkDevice(account: AccountRecord) {
  await sendJsonRequest(SIGNAL_CHAT_HOST, {
    method: 'DELETE',
    path: `/v1/devices/${account.deviceId}`,
    credentials: getAccountCredentials(account),
  });
}

/**
 * Whether the server still accepts the credentials of this device (`GET /v1/accounts/whoami`): `false` after a 401,
 * which is what an unlinked or deregistered device gets. Any other failure throws, as the answer is unknown then.
 */
export async function checkAccountAuthorized(account: AccountRecord) {
  try {
    await sendJsonRequest(SIGNAL_CHAT_HOST, {
      method: 'GET',
      path: '/v1/accounts/whoami',
      credentials: getAccountCredentials(account),
    });
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === HTTP_UNAUTHORIZED) return false;
    throw err;
  }
}

export function getAccountCredentials(account: AccountRecord) {
  return { username: `${account.aci}.${account.deviceId}`, password: account.password };
}

function getKeyPair(privateKeyBytes: Uint8Array): KeyPairBytes {
  const privateKey = wasm.PrivateKey_Deserialize(privateKeyBytes);
  return {
    privateKey: wasm.PrivateKey_Serialize(privateKey),
    publicKey: wasm.PublicKey_Serialize(wasm.PrivateKey_GetPublicKey(privateKey)),
  };
}

/**
 * Decrypts a device name that the server lists (base64 `DeviceName`) with the account's ACI identity private key
 * (Signal Desktop `decryptDeviceName` in `ts/Crypto.node.ts`)
 */
export async function decryptDeviceName(encodedName: string, identityPrivateKey: Uint8Array) {
  const { ephemeralPublic, syntheticIv, ciphertext } = fromBinary(DeviceNameSchema, bufferFromBase64(encodedName));
  const masterSecret = wasm.PrivateKey_Agree(
    wasm.PrivateKey_Deserialize(identityPrivateKey), wasm.PublicKey_Deserialize(ephemeralPublic),
  ) as Uint8Array<ArrayBuffer>;

  const cipherSeed = await hmacSha256(masterSecret, encodeUtf8('cipher'));
  const cipherKey = await hmacSha256(cipherSeed, syntheticIv as Uint8Array<ArrayBuffer>);
  const plaintext = await encryptAesCtr(
    cipherKey, ciphertext as Uint8Array<ArrayBuffer>, new Uint8Array(AES_COUNTER_LENGTH),
  );

  const authKey = await hmacSha256(masterSecret, encodeUtf8('auth'));
  const expectedIv = (await hmacSha256(authKey, plaintext)).slice(0, SYNTHETIC_IV_LENGTH);
  if (!buffersEqual(expectedIv, syntheticIv)) throw new Error('The device name does not match its IV');
  return new TextDecoder().decode(plaintext);
}

/** Encrypts the device name to the account's ACI identity key (Signal Desktop `encryptDeviceName`) */
async function encryptDeviceName(deviceName: string, identityPublicKey: Uint8Array) {
  const plaintext = encodeUtf8(deviceName);
  const ephemeralKey = wasm.PrivateKey_Generate();
  const masterSecret = wasm.PrivateKey_Agree(
    ephemeralKey, wasm.PublicKey_Deserialize(identityPublicKey),
  ) as Uint8Array<ArrayBuffer>;

  const authKey = await hmacSha256(masterSecret, encodeUtf8('auth'));
  const syntheticIv = (await hmacSha256(authKey, plaintext)).slice(0, SYNTHETIC_IV_LENGTH);
  const cipherSeed = await hmacSha256(masterSecret, encodeUtf8('cipher'));
  const cipherKey = await hmacSha256(cipherSeed, syntheticIv);
  const ciphertext = await encryptAesCtr(cipherKey, plaintext, new Uint8Array(AES_COUNTER_LENGTH));

  return bufferToBase64(toBinary(DeviceNameSchema, create(DeviceNameSchema, {
    ephemeralPublic: wasm.PublicKey_Serialize(wasm.PrivateKey_GetPublicKey(ephemeralKey)),
    syntheticIv,
    ciphertext,
  })));
}

function getOptionalBytes(bytes: Uint8Array) {
  return bytes.length ? bytes : undefined;
}
