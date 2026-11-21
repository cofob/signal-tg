import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type { Credentials } from '../net/rest';
import type { Response } from '../proto/generated/SVR2_pb';

import { SIGNAL_SVR2_HOST, SIGNAL_SVR2_MRENCLAVE, SIGNAL_SVR2_PREVIOUS_MRENCLAVE } from '../config';
import { bufferFromHex } from '../../../util/encoding/buffer';
import { encodeUtf8 } from '../crypto';
import {
  BackupResponse_Status,
  ExposeResponse_Status,
  RequestSchema,
  ResponseSchema,
  RestoreResponse_Status,
} from '../proto/generated/SVR2_pb';
import { wasm } from '../wasm';

import AttestedConnection from '../net/AttestedConnection';
import { WebSocketConnectError } from '../net/WebSocketClient';

export type SvrErrorReason = 'pinMismatch' | 'missing' | 'rateLimited' | 'protocolError';

export class SvrError extends Error {
  // Guesses left after a wrong PIN
  constructor(readonly reason: SvrErrorReason, readonly triesRemaining?: number) {
    super(`SVR2 request failed: ${reason}`);
  }
}

type RequestInner = MessageInitShape<typeof RequestSchema>['inner'];
type ResponseInner = Response['inner'];

// Signal Desktop `MAX_SVR2_TRIES` and Signal Android `SecureValueRecoveryV2`
const MAX_TRIES = 10;
// Signal Desktop `storeWithSVR2` tries the expose this many times
const MAX_EXPOSE_ATTEMPTS = 3;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const IS_ALL_DIGITS = /^\p{Nd}+$/u;
const DIGIT = /\p{Nd}/u;
const DIGITS_IN_BLOCK = 10;

/**
 * Normalizes a PIN as Signal Android `PinHashUtil.normalize` and Signal Desktop `normalizePin`: trims it, writes
 * numeric PINs in ASCII digits and applies NFKD.
 */
export function normalizePin(pin: string) {
  let normalized = pin.trim();
  if (IS_ALL_DIGITS.test(normalized)) {
    normalized = Array.from(normalized, (char) => String(getDigitValue(char))).join('');
  }
  return encodeUtf8(normalized.normalize('NFKD'));
}

/**
 * Restores the master key that a PIN protects, from the current enclave and then the previous one, as libsignal-net
 * `Svr2_RestoreMasterKey`. Each wrong PIN uses up a guess, so this runs only for a PIN the user entered.
 */
export async function restoreMasterKey(credentials: Credentials, pin: string) {
  const normalizedPin = normalizePin(pin);
  for (const mrenclave of [SIGNAL_SVR2_MRENCLAVE, SIGNAL_SVR2_PREVIOUS_MRENCLAVE]) {
    const pinHash = wasm.PinHash_FromUsernameMrenclave(normalizedPin, credentials.username, bufferFromHex(mrenclave));
    try {
      const response = await exchange(credentials, mrenclave, {
        case: 'restore', value: { pin: wasm.PinHash_AccessKey(pinHash) },
      });
      if (response?.case !== 'restore') throw new SvrError('protocolError');
      const { status, data, tries } = response.value;
      if (status === RestoreResponse_Status.MISSING) continue;
      if (status === RestoreResponse_Status.PIN_MISMATCH) throw new SvrError('pinMismatch', tries);
      if (status !== RestoreResponse_Status.OK) throw new SvrError('protocolError');
      return { masterKey: wasm.PinHash_DecodeMasterKey(pinHash, data), triesRemaining: tries };
    } catch (err) {
      // A retired enclave that is still configured answers 404
      if (!isEnclaveNotFound(err)) throw err;
    } finally {
      pinHash.free();
    }
  }
  throw new SvrError('missing');
}

/**
 * Stores the master key under a PIN, which also resets the guess count, as libsignal-net
 * `Svr2_StartMasterKeyBackup` and `Svr2_FinishBackup`: the previous enclave first, so a client that falls back to it
 * never reads older data than the current one, then the current enclave. Each enclave gets a backup and an expose
 * request; only the expose is retried, since a repeated backup would reset the data.
 */
export async function backupMasterKey(credentials: Credentials, pin: string, masterKey: Uint8Array) {
  const normalizedPin = normalizePin(pin);
  for (const mrenclave of [SIGNAL_SVR2_PREVIOUS_MRENCLAVE, SIGNAL_SVR2_MRENCLAVE]) {
    try {
      await backupToEnclave(credentials, mrenclave, normalizedPin, masterKey);
    } catch (err) {
      if (mrenclave === SIGNAL_SVR2_MRENCLAVE || !isEnclaveNotFound(err)) throw err;
    }
  }
}

/** Deletes the stored master key from both enclaves, as libsignal-net `Svr2_Delete` */
export async function deleteMasterKeyBackup(credentials: Credentials) {
  const results = await Promise.allSettled([SIGNAL_SVR2_MRENCLAVE, SIGNAL_SVR2_PREVIOUS_MRENCLAVE].map(
    async (mrenclave) => {
      const response = await exchange(credentials, mrenclave, { case: 'delete', value: {} });
      if (response?.case !== 'delete') throw new SvrError('protocolError');
    },
  ));
  const [current, previous] = results;
  if (current.status === 'rejected') throw current.reason;
  if (previous.status === 'rejected' && !isEnclaveNotFound(previous.reason)) throw previous.reason;
}

async function backupToEnclave(
  credentials: Credentials, mrenclave: string, normalizedPin: Uint8Array, masterKey: Uint8Array,
) {
  const pinHash = wasm.PinHash_FromUsernameMrenclave(normalizedPin, credentials.username, bufferFromHex(mrenclave));
  const data = wasm.PinHash_EncodeMasterKey(pinHash, masterKey);
  const accessKey = wasm.PinHash_AccessKey(pinHash);
  pinHash.free();

  const backup = await exchange(credentials, mrenclave, {
    case: 'backup', value: { pin: accessKey, data, maxTries: MAX_TRIES },
  });
  if (backup?.case !== 'backup' || backup.value.status !== BackupResponse_Status.OK) {
    throw new SvrError('protocolError');
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const expose = await exchange(credentials, mrenclave, { case: 'expose', value: { data } });
      // An error means someone reset, deleted or guessed at the data since the backup
      if (expose?.case !== 'expose' || expose.value.status !== ExposeResponse_Status.OK) {
        throw new SvrError('protocolError');
      }
      return;
    } catch (err) {
      if (attempt >= MAX_EXPOSE_ATTEMPTS) throw err;
    }
  }
}

/** Sends one request on a new attested connection, as Signal Android `Svr2Socket` */
async function exchange(credentials: Credentials, mrenclave: string, inner: RequestInner): Promise<ResponseInner> {
  const mrenclaveBytes = bufferFromHex(mrenclave);
  let connection: AttestedConnection;
  try {
    connection = await AttestedConnection.connect(
      SIGNAL_SVR2_HOST,
      `/v1/${mrenclave}`,
      credentials,
      (attestation, now) => wasm.Svr2Client_New(mrenclaveBytes, attestation, now),
    );
  } catch (err) {
    if (err instanceof WebSocketConnectError && err.status === HTTP_TOO_MANY_REQUESTS) {
      throw new SvrError('rateLimited');
    }
    throw err;
  }

  try {
    connection.send(toBinary(RequestSchema, create(RequestSchema, { inner })));
    const response = await connection.receive();
    if (!response) throw new SvrError('protocolError');
    return fromBinary(ResponseSchema, response).inner;
  } finally {
    connection.close();
  }
}

function isEnclaveNotFound(err: unknown) {
  return err instanceof WebSocketConnectError && err.status === HTTP_NOT_FOUND;
}

/**
 * The value of a decimal digit of any script. Unicode puts each script's digits 0 to 9 in a row, and blocks of
 * several digit sets, such as the mathematical digits, are runs of whole sets.
 */
function getDigitValue(char: string) {
  const codePoint = char.codePointAt(0)!;
  let start = codePoint;
  while (DIGIT.test(String.fromCodePoint(start - 1))) start--;
  return (codePoint - start) % DIGITS_IN_BLOCK;
}
