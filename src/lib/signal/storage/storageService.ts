import type ChatConnection from '../chat/ChatConnection';
import type { Credentials } from '../net/rest';
import type { AccountRecord } from '../store/SignalStore';

import { SIGNAL_STORAGE_HOST } from '../config';
import { bufferToBase64, concat } from '../../../util/encoding/buffer';
import {
  decryptAesGcmWithNonce, deriveSecrets, encodeUtf8, hmacSha256,
} from '../crypto';
import { sendHttpRequest } from '../net/http';
import { getBasicAuthorization } from '../net/rest';

import {
  ManifestRecord, ReadOperation, StorageItems, StorageManifest, StorageRecord,
} from '../proto/generated/StorageService';

export type StorageSnapshot = {
  version: bigint;
  // Records keyed by their base64 storage id; unknown fields stay in the records for later writes
  records: Map<string, StorageRecord>;
};

const MASTER_KEY_INFO = '20240801_SIGNAL_SVR_MASTER_KEY';
const STORAGE_KEY_INFO = 'Storage Service Encryption';
const ITEM_KEY_INFO_PREFIX = '20240801_SIGNAL_STORAGE_SERVICE_ITEM_';
const KEY_LENGTH = 32;
const READ_BATCH_SIZE = 1000;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const PROTOBUF_CONTENT_TYPE = 'application/x-protobuf';

/**
 * Reads the whole storage service state: the manifest and every record it lists
 * (Signal Desktop `ts/services/storage.preload.ts`). Returns `undefined` when the account has no manifest yet.
 */
export async function fetchStorageSnapshot(
  account: AccountRecord, connection: ChatConnection,
): Promise<StorageSnapshot | undefined> {
  const storageKey = await getStorageKey(account);
  const credentials = await getStorageCredentials(connection);

  const manifestResponse = await sendStorageRequest(credentials, 'GET', '/v1/storage/manifest');
  if (manifestResponse.status === HTTP_NOT_FOUND) return undefined;
  if (manifestResponse.status !== HTTP_OK) {
    throw new Error(`Storage manifest request failed with HTTP ${manifestResponse.status}`);
  }

  const manifest = StorageManifest.decode(manifestResponse.body);
  const version = manifest.version ?? 0n;
  const manifestKey = await hmacSha256(storageKey, encodeUtf8(`Manifest_${version}`));
  const manifestRecord = ManifestRecord.decode(await decryptAesGcmWithNonce(manifestKey, manifest.value!));
  const identifiers = manifestRecord.identifiers ?? [];

  const records = new Map<string, StorageRecord>();
  for (let i = 0; i < identifiers.length; i += READ_BATCH_SIZE) {
    const readKey = identifiers.slice(i, i + READ_BATCH_SIZE).map(({ raw }) => raw!);
    const response = await sendStorageRequest(
      credentials, 'PUT', '/v1/storage/read', ReadOperation.encode({ readKey }),
    );
    if (response.status !== HTTP_OK) throw new Error(`Storage read failed with HTTP ${response.status}`);

    for (const { key, value } of StorageItems.decode(response.body).items ?? []) {
      if (!key || !value) continue;
      const itemKey = await getItemKey(storageKey, key, manifestRecord.recordIkm);
      records.set(bufferToBase64(key), StorageRecord.decode(await decryptAesGcmWithNonce(itemKey, value)));
    }
  }

  return { version, records };
}

/** The master key comes from the account entropy pool, or directly from older primary devices */
async function getStorageKey(account: AccountRecord) {
  let masterKey = account.masterKey;
  if (!masterKey && account.accountEntropyPool) {
    masterKey = deriveSecrets(KEY_LENGTH, encodeUtf8(account.accountEntropyPool), encodeUtf8(MASTER_KEY_INFO));
  }
  if (!masterKey) throw new Error('No master key: wait for the keys sync from the primary device');
  return hmacSha256(concat(masterKey), encodeUtf8(STORAGE_KEY_INFO));
}

function getItemKey(storageKey: Uint8Array<ArrayBuffer>, key: Uint8Array, recordIkm?: Uint8Array) {
  if (!recordIkm?.length) {
    return hmacSha256(storageKey, encodeUtf8(`Item_${bufferToBase64(key)}`));
  }
  return Promise.resolve(deriveSecrets(KEY_LENGTH, recordIkm, concat(encodeUtf8(ITEM_KEY_INFO_PREFIX), key)));
}

async function getStorageCredentials(connection: ChatConnection): Promise<Credentials> {
  const { status, json } = await connection.sendJsonRequest<Credentials>('GET', '/v1/storage/auth');
  if (status !== HTTP_OK || !json) throw new Error(`Storage auth request failed with HTTP ${status}`);
  return json;
}

function sendStorageRequest(credentials: Credentials, method: string, path: string, body?: Uint8Array) {
  const headers: Record<string, string> = { Authorization: getBasicAuthorization(credentials) };
  if (body) headers['Content-Type'] = PROTOBUF_CONTENT_TYPE;
  return sendHttpRequest(SIGNAL_STORAGE_HOST, {
    method, path, headers, body,
  });
}
