import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type ChatConnection from '../chat/ChatConnection';
import type { Credentials } from '../net/rest';
import type { ManifestRecord } from '../proto/generated/StorageService_pb';
import type { AccountRecord } from '../store/SignalStore';

import { SIGNAL_STORAGE_HOST } from '../config';
import { bufferFromBase64, bufferToBase64, concat } from '../../../util/encoding/buffer';
import {
  decryptAesGcmWithNonce, deriveSecrets, encodeUtf8, encryptAesGcmWithNonce, hmacSha256,
} from '../crypto';
import { sendHttpRequest } from '../net/http';
import { getBasicAuthorization } from '../net/rest';
import { wasm } from '../wasm';

import {
  ManifestRecordSchema,
  ReadOperationSchema,
  StorageItemsSchema,
  StorageManifestSchema,
  WriteOperationSchema,
} from '../proto/generated/StorageService_pb';

/** A new manifest with the records it adds, serialized `StorageRecord`s by base64 storage id */
export type StorageWrite = {
  manifest: ManifestRecord;
  inserts: Map<string, Uint8Array<ArrayBuffer>>;
  deleteIds: string[];
  // The server deletes every stored record first, so the write replaces the whole storage
  shouldClearAll?: boolean;
};

/** The manifest on the server is not encrypted with our storage key; `version` is the one it has */
export class ManifestDecryptError extends Error {
  constructor(readonly version: bigint) {
    super(`Cannot decrypt the storage manifest of version ${version}`);
  }
}

const STORAGE_KEY_INFO = 'Storage Service Encryption';
const ITEM_KEY_INFO_PREFIX = '20240801_SIGNAL_STORAGE_SERVICE_ITEM_';
const KEY_LENGTH = 32;
const READ_BATCH_SIZE = 1000;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const PROTOBUF_CONTENT_TYPE = 'application/x-protobuf';

/** The storage service key: from the account entropy pool, or the master key of older primary devices */
export async function getStorageKey(account: AccountRecord) {
  let masterKey = account.masterKey;
  if (!masterKey && account.accountEntropyPool) {
    masterKey = wasm.AccountEntropyPool_DeriveSvrKey(account.accountEntropyPool);
  }
  if (!masterKey) throw new Error('No master key: wait for the keys sync from the primary device');
  return hmacSha256(concat(masterKey), encodeUtf8(STORAGE_KEY_INFO));
}

export async function getStorageCredentials(connection: ChatConnection): Promise<Credentials> {
  const { status, json } = await connection.sendJsonRequest<Credentials>('GET', '/v1/storage/auth');
  if (status !== HTTP_OK || !json) throw new Error(`Storage auth request failed with HTTP ${status}`);
  return json;
}

/**
 * Fetches and decrypts the manifest when it is newer than `afterVersion`, or any manifest without one
 * (Signal Desktop `fetchManifest` in `ts/services/storage.preload.ts`). Returns `undefined` when the manifest is
 * not newer or the account has none yet. Throws `ManifestDecryptError` for a manifest that the key cannot open.
 */
export async function fetchManifest(
  credentials: Credentials, storageKey: Uint8Array<ArrayBuffer>, afterVersion?: bigint,
): Promise<ManifestRecord | undefined> {
  const path = afterVersion === undefined ? '/v1/storage/manifest' : `/v1/storage/manifest/version/${afterVersion}`;
  const response = await sendStorageRequest(credentials, 'GET', path);
  if (response.status === HTTP_NO_CONTENT || response.status === HTTP_NOT_FOUND) return undefined;
  if (response.status !== HTTP_OK) throw new Error(`Storage manifest request failed with HTTP ${response.status}`);

  const { version, value } = fromBinary(StorageManifestSchema, response.body);
  try {
    const manifestKey = await getManifestKey(storageKey, version);
    return fromBinary(ManifestRecordSchema, await decryptAesGcmWithNonce(manifestKey, value));
  } catch {
    throw new ManifestDecryptError(version);
  }
}

/**
 * Fetches and decrypts the records with `ids` (base64 storage ids). Returns serialized `StorageRecord`s by id;
 * ids the server has no record for are absent.
 */
export async function fetchRecords(
  credentials: Credentials, storageKey: Uint8Array<ArrayBuffer>, recordIkm: Uint8Array, ids: string[],
) {
  const records = new Map<string, Uint8Array<ArrayBuffer>>();
  for (let i = 0; i < ids.length; i += READ_BATCH_SIZE) {
    const readKey = ids.slice(i, i + READ_BATCH_SIZE).map(bufferFromBase64);
    const body = toBinary(ReadOperationSchema, create(ReadOperationSchema, { readKey }));
    const response = await sendStorageRequest(credentials, 'PUT', '/v1/storage/read', body);
    if (response.status !== HTTP_OK) throw new Error(`Storage read failed with HTTP ${response.status}`);

    for (const item of fromBinary(StorageItemsSchema, response.body).items) {
      if (!item.key.length || !item.value.length) continue;
      const itemKey = await getItemKey(storageKey, item.key, recordIkm);
      records.set(bufferToBase64(item.key), await decryptAesGcmWithNonce(itemKey, item.value));
    }
  }
  return records;
}

/**
 * Uploads a manifest with its new records and the ids of replaced records (Signal Desktop `uploadManifest`).
 * New records are encrypted with keys from the manifest's `recordIkm`. Returns `false` when another device wrote
 * a newer manifest first.
 */
export async function writeManifest(credentials: Credentials, storageKey: Uint8Array<ArrayBuffer>, {
  manifest, inserts, deleteIds, shouldClearAll,
}: StorageWrite) {
  const insertItem = [];
  for (const [id, record] of inserts) {
    const key = bufferFromBase64(id);
    const itemKey = await getItemKey(storageKey, key, manifest.recordIkm);
    insertItem.push({ key, value: await encryptAesGcmWithNonce(itemKey, record) });
  }
  const manifestKey = await getManifestKey(storageKey, manifest.version);
  const value = await encryptAesGcmWithNonce(manifestKey, toBinary(ManifestRecordSchema, manifest));
  const body = toBinary(WriteOperationSchema, create(WriteOperationSchema, {
    manifest: { version: manifest.version, value },
    insertItem,
    deleteKey: deleteIds.map(bufferFromBase64),
    clearAll: shouldClearAll,
  }));

  // Signal Android `PushServiceSocket.writeStorageItems`: the manifest is fetched again after a conflict
  const response = await sendStorageRequest(credentials, 'PUT', '/v1/storage?sendRemoteManifestOnConflict=false', body);
  if (response.status === HTTP_CONFLICT) return false;
  if (response.status !== HTTP_OK) throw new Error(`Storage write failed with HTTP ${response.status}`);
  return true;
}

/** Signal Desktop `deriveStorageManifestKey` in `ts/Crypto.node.ts` */
function getManifestKey(storageKey: Uint8Array<ArrayBuffer>, version: bigint) {
  return hmacSha256(storageKey, encodeUtf8(`Manifest_${version}`));
}

/**
 * Signal Desktop `deriveStorageItemKey` in `ts/Crypto.node.ts`: manifests without `recordIkm` come from clients
 * that derive item keys from the storage key
 */
function getItemKey(storageKey: Uint8Array<ArrayBuffer>, key: Uint8Array, recordIkm: Uint8Array) {
  if (!recordIkm.length) {
    return hmacSha256(storageKey, encodeUtf8(`Item_${bufferToBase64(key)}`));
  }
  return Promise.resolve(deriveSecrets(KEY_LENGTH, recordIkm, concat(encodeUtf8(ITEM_KEY_INFO_PREFIX), key)));
}

function sendStorageRequest(credentials: Credentials, method: string, path: string, body?: Uint8Array) {
  const headers: Record<string, string> = { Authorization: getBasicAuthorization(credentials) };
  if (body) headers['Content-Type'] = PROTOBUF_CONTENT_TYPE;
  return sendHttpRequest(SIGNAL_STORAGE_HOST, {
    trafficClass: 'authenticated', method, path, headers, body,
  });
}
