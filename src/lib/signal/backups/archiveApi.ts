import type SignalStore from '../store/SignalStore';
import type { TrafficClass } from '../config';
import type { AccountRecord, ArchiveCredentialsRecord } from '../store/SignalStore';

import { SIGNAL_BACKUP_SERVER_PUBLIC_PARAMS, SIGNAL_CDN_HOSTS, SIGNAL_CHAT_HOST } from '../config';
import { bufferFromBase64, buffersEqual, bufferToBase64 } from '../../../util/encoding/buffer';
import { getServerTime } from '../../../util/serverTime';
import { getAccountCredentials } from '../account/linkDevice';
import { putTusUpload } from '../attachments/uploadAttachment';
import { getRandomBytes } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { getBasicAuthorization } from '../net/rest';
import { wasm } from '../wasm';

export type ArchiveCredentialType = 'messages' | 'media';

/** The keys of an account's archive: the messages backup key comes from the account entropy pool */
export type ArchiveKeys = {
  aci: string;
  backupKey: Uint8Array;
  // Generated at registration; without it the account has no media backup, and the media credential is skipped
  mediaRootBackupKey?: Uint8Array;
};

/** A credential with the key that signs its presentations, which authorizes anonymous requests to the backup service */
export type ArchiveAuth = {
  type: ArchiveCredentialType;
  credential: Uint8Array;
  signingKey: wasm.PrivateKey;
  // 200 for the free tier and 201 for the paid one (zkgroup `BackupLevel`)
  level: number;
};

export type ArchiveErrorKind =
  | 'unauthorized' | 'notFound' | 'tooLarge' | 'rateLimited' | 'server' | 'unexpected'
  // The credential does not belong to the key: the account's backup id comes from another recovery key
  | 'verificationFailed';

export type ArchiveInfo = {
  cdn: number;
  backupDir: string;
  mediaDir: string;
  backupName: string;
  usedSpace?: number;
};

/** The metadata of the backup file on the CDN */
export type ArchiveFileInfo = {
  size: number;
  // Milliseconds since the epoch
  modifiedAt?: number;
};

export type UploadForm = {
  cdn: number;
  key: string;
  headers: Record<string, string>;
  signedUploadLocation: string;
};

type OnProgress = (transferredLength: number, totalLength: number) => void;

type CredentialsResponse = {
  credentials: Record<ArchiveCredentialType, { credential: string; redemptionTime: number }[]>;
};

export class ArchiveError extends Error {
  constructor(readonly kind: ArchiveErrorKind, readonly status: number, readonly retryAfterSeconds?: number) {
    super(`Archive request failed with HTTP ${status} (${kind})`);
  }
}

const SECONDS_PER_DAY = 24 * 60 * 60;
// Signal Desktop `BackupCredentials.#doFetch` in `ts/services/backups/credentials.preload.ts`: a week of credentials
const CREDENTIAL_DAYS = 6;
const RANDOMNESS_LENGTH = 32;
const HTTP_OK = 200;
const HTTP_PARTIAL_CONTENT = 206;
const HTTP_MULTIPLE_CHOICES = 300;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const serverPublicParams = bufferFromBase64(SIGNAL_BACKUP_SERVER_PUBLIC_PARAMS);

/** The backup id that the keys give: it names the backup on the server and tells whether the cached credentials fit */
export function deriveBackupId({ aci, backupKey }: ArchiveKeys) {
  return wasm.BackupKey_DeriveBackupId(backupKey, wasm.ServiceId_ParseFromServiceIdString(aci));
}

/**
 * The credential of `type` for today (Signal Desktop `BackupCredentials.getForToday`), fetched with the credentials of
 * the next days when the cache has none for today. A device that is not the primary device never reserves the backup
 * id: it exists once the primary device enabled backups.
 */
export async function getArchiveAuth(
  store: SignalStore, account: AccountRecord, keys: ArchiveKeys, type: ArchiveCredentialType,
): Promise<ArchiveAuth> {
  const today = getToday();
  let record = await readCache(store, keys);
  let credential = record.credentials.find((item) => item.type === type && item.redemptionTime === today);
  if (!credential) {
    record = await fetchCredentials(store, account, keys, record);
    credential = record.credentials.find((item) => item.type === type && item.redemptionTime === today);
    if (!credential) throw new ArchiveError('unexpected', HTTP_OK);
  }

  const signingKey = wasm.BackupKey_DeriveEcKey(
    getTypeKey(keys, type), wasm.ServiceId_ParseFromServiceIdString(keys.aci),
  );
  return {
    type,
    credential: credential.credential,
    signingKey,
    level: wasm.BackupAuthCredential_GetBackupLevel(credential.credential),
  };
}

/** Tells the service the public key that checks our signed requests, once per type (`PUT /v1/archives/keys`) */
export async function ensureArchivePublicKey(store: SignalStore, keys: ArchiveKeys, auth: ArchiveAuth) {
  const record = await readCache(store, keys);
  if (record.publicKeysSet[auth.type]) return;

  const publicKey = wasm.PrivateKey_GetPublicKey(auth.signingKey);
  await sendArchiveRequest(auth, {
    method: 'PUT',
    path: '/v1/archives/keys',
    json: { backupIdPublicKey: bufferToBase64(wasm.PublicKey_Serialize(publicKey)) },
  });
  await writeCache(store, { ...record, publicKeysSet: { ...record.publicKeysSet, [auth.type]: true } });
}

/** Where the backup is stored on the CDN (`GET /v1/archives`) */
export async function getArchiveInfo(auth: ArchiveAuth) {
  const response = await sendArchiveRequest(auth, { method: 'GET', path: '/v1/archives' });
  return parseJson<ArchiveInfo>(response.body);
}

/** Keeps the backup from expiring: the service deletes a backup that is neither refreshed nor replaced for 30 days */
export async function refreshArchive(auth: ArchiveAuth) {
  await sendArchiveRequest(auth, { method: 'POST', path: '/v1/archives' });
}

/** Deletes the backup and the public key of the backup id (`DELETE /v1/archives`) */
export async function deleteArchive(auth: ArchiveAuth) {
  await sendArchiveRequest(auth, { method: 'DELETE', path: '/v1/archives' });
}

/**
 * Uploads the encrypted backup file: the service gives an upload form for its size (`GET /v1/archives/upload/form`),
 * and the file goes to the CDN with it, as an attachment does. 413 means that the file is too large.
 */
export async function uploadArchive(
  auth: ArchiveAuth, file: Uint8Array, options: { signal?: AbortSignal; onProgress?: OnProgress } = {},
) {
  const response = await sendArchiveRequest(auth, {
    method: 'GET', path: `/v1/archives/upload/form?uploadLength=${file.length}`,
  });
  await putTusUpload(parseJson<UploadForm>(response.body), file, 'unauthenticated', options);
}

/** The headers that the backup CDN wants for reading, which last a day (`GET /v1/archives/auth/read`) */
export async function getArchiveReadHeaders(auth: ArchiveAuth, cdn: number) {
  const response = await sendArchiveRequest(auth, { method: 'GET', path: `/v1/archives/auth/read?cdn=${cdn}` });
  return parseJson<{ headers: Record<string, string> }>(response.body).headers;
}

/** The size and time of the backup file: a request for its first byte, since the CDN answers it with both */
export async function getArchiveFileInfo(
  { cdn, backupDir, backupName }: ArchiveInfo, readHeaders: Record<string, string>,
): Promise<ArchiveFileInfo | undefined> {
  const response = await sendHttpRequest(getCdnHost(cdn), {
    trafficClass: 'unauthenticated',
    method: 'GET',
    path: getBackupPath(backupDir, backupName),
    headers: { ...readHeaders, Range: 'bytes=0-0' },
  });
  if (response.status === HTTP_NOT_FOUND) return undefined;
  if (response.status !== HTTP_OK && response.status !== HTTP_PARTIAL_CONTENT) {
    throw buildError(response.status, response.headers);
  }

  const range = /\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
  const size = range ? Number(range[1]) : Number(response.headers.get('content-length') ?? response.body.length);
  const modified = Date.parse(response.headers.get('last-modified') ?? '');
  return { size, modifiedAt: Number.isNaN(modified) ? undefined : modified };
}

/** Downloads the encrypted backup file; `undefined` when the CDN has none */
export async function downloadArchive(
  { cdn, backupDir, backupName }: ArchiveInfo,
  readHeaders: Record<string, string>,
  options: { signal?: AbortSignal; onProgress?: OnProgress } = {},
) {
  const response = await sendHttpRequest(getCdnHost(cdn), {
    trafficClass: 'unauthenticated',
    method: 'GET',
    path: getBackupPath(backupDir, backupName),
    headers: readHeaders,
    signal: options.signal,
    onReceiveProgress: options.onProgress,
  });
  if (response.status === HTTP_NOT_FOUND) return undefined;
  if (response.status !== HTTP_OK) throw buildError(response.status, response.headers);
  return response.body;
}

/** Forgets the credentials, such as after the recovery key changed */
export function clearArchiveCredentials(store: SignalStore) {
  return store.removeItem('archiveCredentials');
}

/**
 * Fetches the credentials of the coming week (`GET /v1/archives/auth`) and checks each against the key it was
 * requested with. A 404 says that the account has no backup id: a primary device reserves it with the requests of its
 * keys (`PUT /v1/archives/backupid`) and asks again.
 */
async function fetchCredentials(
  store: SignalStore, account: AccountRecord, keys: ArchiveKeys, cached: ArchiveCredentialsRecord,
) {
  const start = getToday();
  const end = start + CREDENTIAL_DAYS * SECONDS_PER_DAY;
  const path = `/v1/archives/auth?redemptionStartSeconds=${start}&redemptionEndSeconds=${end}`;
  const credentials = getAccountCredentials(account);

  let response = await sendAuthenticatedRequest({ method: 'GET', path }, credentials);
  if (response.status === HTTP_NOT_FOUND && account.deviceId === 1) {
    await reserveBackupId(keys, credentials);
    response = await sendAuthenticatedRequest({ method: 'GET', path }, credentials);
  }
  if (response.status !== HTTP_OK) throw buildError(response.status, response.headers);

  const received = parseJson<CredentialsResponse>(response.body);
  const result: ArchiveCredentialsRecord['credentials'] = [];
  const issued = new Set<string>();
  for (const type of getTypes(keys)) {
    const context = wasm.BackupAuthCredentialRequestContext_New(
      getTypeKey(keys, type), uuidBytes(keys.aci),
    );
    for (const { credential, redemptionTime } of received.credentials[type] ?? []) {
      if (redemptionTime < start || redemptionTime > end) throw new ArchiveError('unexpected', HTTP_OK);
      const id = `${type}:${redemptionTime}`;
      if (issued.has(id)) throw new ArchiveError('unexpected', HTTP_OK);
      issued.add(id);

      let verified;
      try {
        verified = wasm.BackupAuthCredentialRequestContext_ReceiveResponse(
          context, bufferFromBase64(credential), redemptionTime, serverPublicParams,
        );
      } catch {
        throw new ArchiveError('verificationFailed', HTTP_OK);
      }
      result.push({ type, redemptionTime, credential: verified });
    }
  }

  // Credentials of the cache that the response lacks and that are still in range stay
  const kept = cached.credentials.filter((item) => (
    item.redemptionTime >= start && item.redemptionTime <= end && !issued.has(`${item.type}:${item.redemptionTime}`)
  ));
  const record: ArchiveCredentialsRecord = {
    ...cached,
    credentials: [...result, ...kept].sort((a, b) => a.redemptionTime - b.redemptionTime),
  };
  await writeCache(store, record);
  return record;
}

/** Reserves the backup ids of the messages backup and the media backup; repeating it is safe */
async function reserveBackupId(keys: ArchiveKeys, credentials: { username: string; password: string }) {
  const requestOf = (type: ArchiveCredentialType) => bufferToBase64(wasm.BackupAuthCredentialRequestContext_GetRequest(
    wasm.BackupAuthCredentialRequestContext_New(getTypeKey(keys, type), uuidBytes(keys.aci)),
  ));
  const response = await sendAuthenticatedRequest({
    method: 'PUT',
    path: '/v1/archives/backupid',
    json: {
      messagesBackupAuthCredentialRequest: requestOf('messages'),
      mediaBackupAuthCredentialRequest: keys.mediaRootBackupKey ? requestOf('media') : undefined,
    },
  }, credentials);
  if (response.status >= HTTP_MULTIPLE_CHOICES) throw buildError(response.status, response.headers);
}

/** An anonymous request that the presentation of the credential and its signature authorize */
async function sendArchiveRequest(auth: ArchiveAuth, request: { method: string; path: string; json?: unknown }) {
  const presentation = wasm.BackupAuthCredential_PresentDeterministic(
    auth.credential, serverPublicParams, getRandomBytes(RANDOMNESS_LENGTH),
  );
  // The presentation does not name the account, so these requests take the tunnel without credentials
  const response = await sendJson(request, {
    'X-Signal-ZK-Auth': bufferToBase64(presentation),
    'X-Signal-ZK-Auth-Signature': bufferToBase64(wasm.PrivateKey_Sign(auth.signingKey, presentation)),
  }, 'unauthenticated');
  if (response.status >= HTTP_MULTIPLE_CHOICES) throw buildError(response.status, response.headers);
  return response;
}

function sendAuthenticatedRequest(
  request: { method: string; path: string; json?: unknown }, credentials: { username: string; password: string },
) {
  return sendJson(request, { Authorization: getBasicAuthorization(credentials) }, 'authenticated');
}

function sendJson(
  { method, path, json }: { method: string; path: string; json?: unknown },
  headers: Record<string, string>,
  trafficClass: TrafficClass,
) {
  return sendHttpRequest(SIGNAL_CHAT_HOST, {
    trafficClass,
    method,
    path,
    headers: json === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : textEncoder.encode(JSON.stringify(json)),
  });
}

function buildError(status: number, headers: Map<string, string>) {
  const retryAfter = Number(headers.get('retry-after'));
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) return new ArchiveError('unauthorized', status);
  if (status === HTTP_NOT_FOUND) return new ArchiveError('notFound', status);
  if (status === HTTP_PAYLOAD_TOO_LARGE) return new ArchiveError('tooLarge', status);
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new ArchiveError('rateLimited', status, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  return new ArchiveError(status >= HTTP_SERVER_ERROR ? 'server' : 'unexpected', status);
}

function parseJson<T>(body: Uint8Array) {
  return JSON.parse(textDecoder.decode(body)) as T;
}

function getCdnHost(cdn: number) {
  const host = SIGNAL_CDN_HOSTS[cdn];
  if (!host) throw new Error(`Unknown CDN ${cdn}`);
  return host;
}

function getBackupPath(backupDir: string, backupName: string) {
  return `/backups/${encodeURIComponent(backupDir)}/${encodeURIComponent(backupName)}`;
}

/** Credentials are good for a day, which starts at the midnight of the server's clock in UTC */
function getToday() {
  return Math.floor(getServerTime() / SECONDS_PER_DAY) * SECONDS_PER_DAY;
}

function getTypes(keys: ArchiveKeys): ArchiveCredentialType[] {
  return keys.mediaRootBackupKey ? ['messages', 'media'] : ['messages'];
}

function getTypeKey(keys: ArchiveKeys, type: ArchiveCredentialType) {
  return type === 'messages' ? keys.backupKey : keys.mediaRootBackupKey!;
}

function uuidBytes(aci: string) {
  return wasm.ServiceId_ParseFromServiceIdString(aci).subarray(1);
}

/** The cache of the credentials, which another backup id invalidates */
async function readCache(store: SignalStore, keys: ArchiveKeys): Promise<ArchiveCredentialsRecord> {
  const backupId = deriveBackupId(keys);
  const record = await store.getItem('archiveCredentials');
  if (record && buffersEqual(record.backupId, backupId)) return record;
  return { backupId, credentials: [], publicKeysSet: {} };
}

function writeCache(store: SignalStore, record: ArchiveCredentialsRecord) {
  return store.setItem('archiveCredentials', record);
}
