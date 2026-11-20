import type { ProvisionMessage } from '../proto/generated/Provisioning';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord, KeyPairBytes } from '../store/SignalStore';

import { SIGNAL_CHAT_HOST } from '../config';
import { bufferToBase64 } from '../../../util/encoding/buffer';
import {
  encodeUtf8, encryptAesCtr, generateRegistrationId, getRandomBytes, hmacSha256,
} from '../crypto';
import { sendJsonRequest } from '../net/rest';
import { toPniServiceId, uuidToString } from '../serviceId';
import { wasm } from '../wasm';
import { generateKyberPreKeys, generateSignedPreKey, uploadOneTimePreKeys } from './preKeys';

import { DeviceName } from '../proto/generated/DeviceName';

type LinkDeviceResponse = {
  uuid: string;
  pni?: string;
  deviceId: number;
};

const PASSWORD_BYTES = 16;
const SYNTHETIC_IV_LENGTH = 16;
const AES_COUNTER_LENGTH = 16;

/**
 * Registers this browser as a linked device with the keys from the primary device's provisioning message
 * (Signal Desktop `AccountManager.createAccount` and `WebAPI.linkDevice`).
 */
export async function linkDevice(store: SignalStore, message: ProvisionMessage, deviceName: string) {
  const aci = message.aciBinary?.length ? uuidToString(message.aciBinary) : message.aci;
  const pni = message.pniBinary?.length ? uuidToString(message.pniBinary) : message.pni;
  if (!aci || !message.aciIdentityKeyPrivate || !message.provisioningCode) {
    throw new Error('Provisioning message is incomplete');
  }

  const aciIdentityKeyPair = getKeyPair(message.aciIdentityKeyPrivate);
  const pniIdentityKeyPair = message.pniIdentityKeyPrivate?.length
    ? getKeyPair(message.pniIdentityKeyPrivate)
    : undefined;
  const hasPni = Boolean(message.number && pni && pniIdentityKeyPair);
  const pniServiceId = pni ? toPniServiceId(pni) : undefined;

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
        capabilities: {
          // The server only uses the primary device's value
          attachmentBackfill: false,
          spqr: true,
          usernameChangeSyncMessage: true,
          optionalPhoneNumber: !message.number,
          storage: false,
        },
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
    number: message.number,
    deviceId: response.deviceId,
    deviceName,
    password,
    registrationId,
    pniRegistrationId,
    profileKey: message.profileKey,
    accountEntropyPool: message.accountEntropyPool,
    mediaRootBackupKey: message.mediaRootBackupKey,
    ephemeralBackupKey: message.ephemeralBackupKey,
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

  return bufferToBase64(DeviceName.encode({
    ephemeralPublic: wasm.PublicKey_Serialize(wasm.PrivateKey_GetPublicKey(ephemeralKey)),
    syntheticIv,
    ciphertext,
  }));
}
