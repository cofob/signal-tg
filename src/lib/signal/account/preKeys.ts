import type { Credentials } from '../net/rest';
import type SignalStore from '../store/SignalStore';
import type { KeyPairBytes } from '../store/SignalStore';

import { SIGNAL_CHAT_HOST } from '../config';
import { bufferToBase64 } from '../../../util/encoding/buffer';
import { sendJsonRequest } from '../net/rest';
import { wasm } from '../wasm';

export type IdentityKind = 'aci' | 'pni';

export type SignedPreKeyUpload = {
  keyId: number;
  publicKey: string;
  signature: string;
};

type PreKeyUpload = {
  keyId: number;
  publicKey: string;
};

type GeneratedPreKey = {
  record: Uint8Array;
  upload: SignedPreKeyUpload;
};

export type LastResortPreKeys = {
  keyId: number;
  signedPreKey: GeneratedPreKey;
  pqLastResortPreKey: GeneratedPreKey;
};

const MAX_KEY_ID = 0xffffff;
const PRE_KEY_BATCH_SIZE = 100;

/** Picks a random starting id so that ids from earlier installs are unlikely to repeat */
function getInitialKeyId() {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return (value % (MAX_KEY_ID - PRE_KEY_BATCH_SIZE * 2)) + 1;
}

async function allocateKeyIds(
  store: SignalStore, serviceId: string, kind: 'preKey' | 'signedPreKey' | 'kyberPreKey', count: number,
) {
  const nextKeyIds = await store.getItem('nextKeyIds') ?? {};
  const current = nextKeyIds[serviceId] ?? {
    preKey: getInitialKeyId(), signedPreKey: getInitialKeyId(), kyberPreKey: getInitialKeyId(),
  };
  const start = current[kind];
  const ids = Array.from({ length: count }, (_, i) => ((start + i - 1) % MAX_KEY_ID) + 1);
  nextKeyIds[serviceId] = { ...current, [kind]: (ids[ids.length - 1] % MAX_KEY_ID) + 1 };
  await store.setItem('nextKeyIds', nextKeyIds);
  return ids;
}

export async function generateSignedPreKey(store: SignalStore, serviceId: string, identityKey: KeyPairBytes) {
  const [keyId] = await allocateKeyIds(store, serviceId, 'signedPreKey', 1);
  const { record, upload } = createSignedPreKey(keyId, identityKey);
  await store.setSignedPreKey(serviceId, keyId, record);
  return upload;
}

export async function generateKyberPreKeys(
  store: SignalStore, serviceId: string, identityKey: KeyPairBytes, count: number, isLastResort?: boolean,
) {
  const keyIds = await allocateKeyIds(store, serviceId, 'kyberPreKey', count);
  const uploads: SignedPreKeyUpload[] = [];
  const entries: [number, { record: Uint8Array; isLastResort?: boolean }][] = [];

  for (const keyId of keyIds) {
    const { record, upload } = createKyberPreKey(keyId, identityKey);
    entries.push([keyId, { record, isLastResort }]);
    uploads.push(upload);
  }

  await store.setKyberPreKeys(serviceId, entries);
  return uploads;
}

/**
 * Signed and Kyber last-resort prekeys for a new account. Registration needs them before the server
 * assigns the service id they are stored under, so `saveLastResortPreKeys` stores them afterwards.
 */
export function createLastResortPreKeys(identityKey: KeyPairBytes): LastResortPreKeys {
  const keyId = getInitialKeyId();
  return {
    keyId,
    signedPreKey: createSignedPreKey(keyId, identityKey),
    pqLastResortPreKey: createKyberPreKey(keyId, identityKey),
  };
}

/** Stores the last-resort prekeys of a new account; later key ids follow theirs */
export async function saveLastResortPreKeys(store: SignalStore, serviceId: string, keys: LastResortPreKeys) {
  const { keyId, signedPreKey, pqLastResortPreKey } = keys;
  await store.setSignedPreKey(serviceId, keyId, signedPreKey.record);
  await store.setKyberPreKeys(serviceId, [[keyId, { record: pqLastResortPreKey.record, isLastResort: true }]]);

  const nextKeyIds = await store.getItem('nextKeyIds') ?? {};
  const nextKeyId = (keyId % MAX_KEY_ID) + 1;
  nextKeyIds[serviceId] = { preKey: getInitialKeyId(), signedPreKey: nextKeyId, kyberPreKey: nextKeyId };
  await store.setItem('nextKeyIds', nextKeyIds);
}

function createSignedPreKey(keyId: number, identityKey: KeyPairBytes) {
  const identityPrivateKey = wasm.PrivateKey_Deserialize(identityKey.privateKey);
  const privateKey = wasm.PrivateKey_Generate();
  const publicKey = wasm.PrivateKey_GetPublicKey(privateKey);
  const serializedPublicKey = wasm.PublicKey_Serialize(publicKey);
  const signature = wasm.PrivateKey_Sign(identityPrivateKey, serializedPublicKey);
  const record = wasm.SignedPreKeyRecord_New(keyId, Date.now(), publicKey, privateKey, signature);
  return {
    record: wasm.SignedPreKeyRecord_Serialize(record),
    upload: { keyId, publicKey: bufferToBase64(serializedPublicKey), signature: bufferToBase64(signature) },
  };
}

function createKyberPreKey(keyId: number, identityKey: KeyPairBytes) {
  const identityPrivateKey = wasm.PrivateKey_Deserialize(identityKey.privateKey);
  const keyPair = wasm.KyberKeyPair_Generate();
  const serializedPublicKey = wasm.KyberPublicKey_Serialize(wasm.KyberKeyPair_GetPublicKey(keyPair));
  const signature = wasm.PrivateKey_Sign(identityPrivateKey, serializedPublicKey);
  const record = wasm.KyberPreKeyRecord_New(keyId, Date.now(), keyPair, signature);
  return {
    record: wasm.KyberPreKeyRecord_Serialize(record),
    upload: { keyId, publicKey: bufferToBase64(serializedPublicKey), signature: bufferToBase64(signature) },
  };
}

export async function generatePreKeys(store: SignalStore, serviceId: string, count: number) {
  const keyIds = await allocateKeyIds(store, serviceId, 'preKey', count);
  const uploads: PreKeyUpload[] = [];
  const records: [number, Uint8Array][] = [];

  for (const keyId of keyIds) {
    const privateKey = wasm.PrivateKey_Generate();
    const publicKey = wasm.PrivateKey_GetPublicKey(privateKey);
    records.push([keyId, wasm.PreKeyRecord_Serialize(wasm.PreKeyRecord_New(keyId, publicKey, privateKey))]);
    uploads.push({ keyId, publicKey: bufferToBase64(wasm.PublicKey_Serialize(publicKey)) });
  }

  await store.setPreKeys(serviceId, records);
  return uploads;
}

/** Generates and uploads a batch of one-time EC and Kyber prekeys (`PUT /v2/keys`) */
export async function uploadOneTimePreKeys(
  store: SignalStore,
  credentials: Credentials,
  kind: IdentityKind,
  serviceId: string,
  identityKey: KeyPairBytes,
) {
  const preKeys = await generatePreKeys(store, serviceId, PRE_KEY_BATCH_SIZE);
  const pqPreKeys = await generateKyberPreKeys(store, serviceId, identityKey, PRE_KEY_BATCH_SIZE);

  await sendJsonRequest(SIGNAL_CHAT_HOST, {
    method: 'PUT',
    path: `/v2/keys?identity=${kind}`,
    json: { preKeys, pqPreKeys },
    credentials,
  });
}
