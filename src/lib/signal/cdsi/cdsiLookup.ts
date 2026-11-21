import { create, mergeFromBinary, toBinary } from '@bufbuild/protobuf';

import type ChatConnection from '../chat/ChatConnection';
import type { Credentials } from '../net/rest';
import type SignalStore from '../store/SignalStore';
import type { CdsiToken } from '../store/SignalStore';

import { SIGNAL_CDSI_HOST, SIGNAL_CDSI_MRENCLAVE } from '../config';
import { bufferFromHex, concat } from '../../../util/encoding/buffer';
import { uuidToBytes, uuidToString } from '../serviceId';
import { wasm } from '../wasm';

import AttestedConnection, { AttestedCloseError } from '../net/AttestedConnection';
import { WebSocketConnectError } from '../net/WebSocketClient';
import { ClientRequestSchema, ClientResponseSchema } from '../proto/generated/Cdsi_pb';

export type AciAndAccessKey = {
  aci: string;
  accessKey: Uint8Array;
};

/** The account of a phone number; both ids are absent for numbers without a Signal account */
export type CdsiRecord = {
  aci?: string;
  pni?: string;
};

// `unavailable`: the enclave could not be reached or attested
export type CdsiErrorReason = 'rateLimited' | 'invalidArgument' | 'serverError' | 'unavailable' | 'protocolError';

export class CdsiError extends Error {
  // Seconds to wait before the next lookup, for `rateLimited`
  constructor(readonly reason: CdsiErrorReason, readonly retryAfter?: number, cause?: unknown) {
    super(`CDSI lookup failed: ${reason}`, { cause });
  }
}

type LookupResult = {
  records: Map<string, CdsiRecord>;
  token: Uint8Array;
};

type CachedAuth = {
  credentials: Credentials;
  fetchedAt: number;
};

// A country code and at most 15 digits in all
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
// Numbers of a refresh per request; libsignal-net sends any number in one request, this keeps each one bounded
const MAX_NEW_E164S_PER_REQUEST = 1000;
const E164_LENGTH = 8;
const UUID_LENGTH = 16;
const RECORD_LENGTH = E164_LENGTH + UUID_LENGTH * 2;
const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;
const MILLISECONDS_IN_SECOND = 1000;
// Signal Desktop `CDSBase` reuses directory credentials for this long
const AUTH_TTL_MS = 23 * 60 * 60 * MILLISECONDS_IN_SECOND;
// Close codes of libsignal-net `CdsiCloseCode` (`rust/net/src/cdsi.rs`)
const CLOSE_INVALID_ARGUMENT = 4003;
const CLOSE_RATE_LIMITED = 4008;
const CLOSE_SERVER_ERROR = 4013;
const CLOSE_SERVER_UNAVAILABLE = 4014;
const CLOSE_INVALID_TOKEN = 4101;

let cachedAuth: CachedAuth | undefined;
// `Date.now()` before which the server refuses lookups
let retryAfterAt = 0;

/**
 * Finds the accounts of phone numbers in the contact discovery enclave, as libsignal-net `cdsi.rs`, which Signal
 * Desktop `cdsLookup` uses. A lookup sends only the numbers asked for, without a token, as Desktop does.
 * `acisAndAccessKeys` of known users let the enclave return ACIs for their numbers. Numbers that are not E.164 have
 * no account.
 */
export async function lookUpE164s(
  connection: ChatConnection, e164s: string[], acisAndAccessKeys: AciAndAccessKey[] = [],
) {
  checkRetryAfter();
  const valid = getValidE164s(e164s);
  if (!valid.length) return buildResult(e164s, new Map());
  const credentials = await getDirectoryAuth(connection);
  const { records } = await requestLookup(credentials, valid, acisAndAccessKeys, undefined).catch((err) => {
    throw toCdsiError(err);
  });
  return buildResult(e164s, records);
}

/**
 * Looks up the numbers of a whole contact list in batches, like Signal Android `ContactDiscoveryRefreshV2`: each
 * request sends the numbers of earlier refreshes again with the token that the server gave for them, so only new
 * numbers count against the rate limit.
 */
export async function refreshE164s(
  connection: ChatConnection, store: SignalStore, e164s: string[], acisAndAccessKeys: AciAndAccessKey[] = [],
) {
  checkRetryAfter();
  const credentials = await getDirectoryAuth(connection);
  const records = new Map<string, CdsiRecord>();
  const valid = getValidE164s(e164s);
  for (let offset = 0; offset < valid.length; offset += MAX_NEW_E164S_PER_REQUEST) {
    const batch = valid.slice(offset, offset + MAX_NEW_E164S_PER_REQUEST);
    let saved = await store.getItem('cdsiToken');
    let result: LookupResult;
    try {
      result = await requestLookup(credentials, batch, acisAndAccessKeys, saved);
    } catch (err) {
      if (!saved || !(err instanceof AttestedCloseError) || err.code !== CLOSE_INVALID_TOKEN) throw toCdsiError(err);
      // The token expired or the saved numbers no longer match it: they count as new again
      saved = undefined;
      result = await requestLookup(credentials, batch, acisAndAccessKeys, saved).catch((retryErr) => {
        throw toCdsiError(retryErr);
      });
    }
    result.records.forEach((record, e164) => records.set(e164, record));
    const refreshed = new Set([...saved?.e164s ?? [], ...batch]);
    await store.setItem('cdsiToken', { token: result.token, e164s: [...refreshed] });
  }
  return buildResult(e164s, records);
}

/** Forgets the directory credentials and the rate limit of the account that signed out */
export function resetCdsiState() {
  cachedAuth = undefined;
  retryAfterAt = 0;
}

function checkRetryAfter() {
  const waitMs = retryAfterAt - Date.now();
  if (waitMs > 0) throw new CdsiError('rateLimited', Math.ceil(waitMs / MILLISECONDS_IN_SECOND));
}

function getValidE164s(e164s: string[]) {
  return [...new Set(e164s.filter((e164) => E164_PATTERN.test(e164)))];
}

function buildResult(e164s: string[], records: Map<string, CdsiRecord>) {
  return new Map(e164s.map((e164) => [e164, records.get(e164) ?? {}]));
}

async function requestLookup(
  credentials: Credentials,
  e164s: string[],
  acisAndAccessKeys: AciAndAccessKey[],
  saved: CdsiToken | undefined,
): Promise<LookupResult> {
  const previous = new Set(saved?.e164s);
  const mrenclave = bufferFromHex(SIGNAL_CDSI_MRENCLAVE);
  const connection = await AttestedConnection.connect(
    SIGNAL_CDSI_HOST,
    `/v1/${SIGNAL_CDSI_MRENCLAVE}/discovery`,
    // The directory token is issued to the account, so through the sealed sender proxy Signal could tie its address to it
    'authenticated',
    credentials,
    (attestation, now) => wasm.Cds2ClientState_New(mrenclave, attestation, now),
  );

  try {
    connection.send(toBinary(ClientRequestSchema, create(ClientRequestSchema, {
      aciUakPairs: concat(...acisAndAccessKeys.map(({ aci, accessKey }) => concat(uuidToBytes(aci), accessKey))),
      prevE164s: encodeE164s([...previous]),
      newE164s: encodeE164s(e164s.filter((e164) => !previous.has(e164))),
      token: saved?.token,
    })));
    const tokenResponse = await connection.receive();
    const response = create(ClientResponseSchema);
    if (tokenResponse) mergeFromBinary(ClientResponseSchema, response, tokenResponse);
    if (!response.token.length) throw new CdsiError('protocolError');
    const { token } = response;

    connection.send(toBinary(ClientRequestSchema, create(ClientRequestSchema, { tokenAck: true })));
    for (let message = await connection.receive(); message; message = await connection.receive()) {
      mergeFromBinary(ClientResponseSchema, response, message);
    }
    return { records: parseRecords(response.e164PniAciTriples), token };
  } finally {
    connection.close();
  }
}

async function getDirectoryAuth(connection: ChatConnection) {
  if (cachedAuth && Date.now() - cachedAuth.fetchedAt < AUTH_TTL_MS) return cachedAuth.credentials;

  const { status, json } = await connection.sendJsonRequest<Credentials>('GET', '/v2/directory/auth');
  if (status === HTTP_TOO_MANY_REQUESTS) throw new CdsiError('rateLimited');
  if (status !== HTTP_OK || !json) throw new Error(`Directory credentials request failed with HTTP ${status}`);
  cachedAuth = { credentials: json, fetchedAt: Date.now() };
  return json;
}

/** Maps the close codes of failed lookups (libsignal-net `err_for_close`) */
function toCdsiError(err: unknown) {
  if (err instanceof WebSocketConnectError && err.status === HTTP_TOO_MANY_REQUESTS) {
    return new CdsiError('rateLimited');
  }
  if (err instanceof CdsiError) return err;
  if (!(err instanceof AttestedCloseError)) return new CdsiError('unavailable', undefined, err);

  switch (err.code) {
    case CLOSE_RATE_LIMITED: {
      const retryAfter = parseRetryAfter(err.reason);
      if (retryAfter !== undefined) {
        retryAfterAt = Math.max(retryAfterAt, Date.now() + retryAfter * MILLISECONDS_IN_SECOND);
      }
      return new CdsiError('rateLimited', retryAfter);
    }
    case CLOSE_INVALID_ARGUMENT:
      return new CdsiError('invalidArgument');
    case CLOSE_SERVER_ERROR:
    case CLOSE_SERVER_UNAVAILABLE:
      return new CdsiError('serverError');
    default:
      return new CdsiError('protocolError', undefined, err);
  }
}

/** The `retry_after` seconds of a rate limit close reason such as `{"retry_after":30}` */
function parseRetryAfter(reason: string) {
  try {
    const retryAfter = (JSON.parse(reason) as { retry_after?: unknown }).retry_after;
    return typeof retryAfter === 'number' && retryAfter >= 0 ? retryAfter : undefined;
  } catch {
    return undefined;
  }
}

/** Each number as 8 big-endian bytes */
function encodeE164s(e164s: string[]) {
  const bytes = new Uint8Array(e164s.length * E164_LENGTH);
  const view = new DataView(bytes.buffer);
  e164s.forEach((e164, i) => view.setBigUint64(i * E164_LENGTH, BigInt(e164.slice(1))));
  return bytes;
}

/** Triples of a number, its PNI and ACI; zero ids are absent */
function parseRecords(triples: Uint8Array) {
  if (triples.length % RECORD_LENGTH) throw new CdsiError('protocolError');

  const records = new Map<string, CdsiRecord>();
  const view = new DataView(triples.buffer, triples.byteOffset, triples.byteLength);
  for (let offset = 0; offset < triples.length; offset += RECORD_LENGTH) {
    const e164 = view.getBigUint64(offset);
    if (!e164) continue;
    const pni = parseUuid(triples.subarray(offset + E164_LENGTH, offset + E164_LENGTH + UUID_LENGTH));
    const aci = parseUuid(triples.subarray(offset + E164_LENGTH + UUID_LENGTH, offset + RECORD_LENGTH));
    records.set(`+${e164}`, { aci, pni });
  }
  return records;
}

function parseUuid(bytes: Uint8Array) {
  return bytes.some(Boolean) ? uuidToString(bytes) : undefined;
}
