import type { Credentials } from '../net/rest';

import { SIGNAL_SVRB_HOST, SIGNAL_SVRB_MRENCLAVES } from '../config';
import { bufferFromHex } from '../../../util/encoding/buffer';
import { wasm } from '../wasm';

import AttestedConnection from '../net/AttestedConnection';
import { WebSocketConnectError } from '../net/WebSocketClient';

/**
 * `dataMissing`: the enclaves hold no key for the backup; `restoreFailed`: they hold one, but not the one the file names
 * (permanent: the tries it left do not help); `invalidData`: the metadata or the saved chain is malformed;
 * `unavailable`: no enclave could be reached or attested, which uses up no try.
 */
export type SvrBErrorReason = 'dataMissing' | 'restoreFailed' | 'invalidData' | 'decryptionFailed' | 'rateLimited'
  | 'unavailable' | 'protocolError';

export class SvrBError extends Error {
  constructor(readonly reason: SvrBErrorReason, cause?: unknown) {
    super(`SVR-B request failed: ${reason}`, { cause });
  }
}

export type StoreResult = {
  // The token that the keys of the new backup file derive from
  forwardSecrecyToken: Uint8Array;
  // The unencrypted header of the file, after `SBACKUP\x01`
  metadata: Uint8Array;
  // The state to keep and give the next store, once the file is uploaded
  nextBackupData: Uint8Array;
};

export type RestoreResult = {
  forwardSecrecyToken: Uint8Array;
  nextBackupData: Uint8Array;
};

const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const SALT_LENGTH = 32;
// Error names of `rust/signal-wasm/src/svrb.rs`
const ERROR_REASONS: Record<string, SvrBErrorReason | undefined> = {
  SvrBDataMissing: 'dataMissing',
  SvrBRestoreFailed: 'restoreFailed',
  SvrBInvalidData: 'invalidData',
  SvrBDecryption: 'decryptionFailed',
  SvrBProtocol: 'protocolError',
};
// Which error an attempt on several enclaves reports, first to last (libsignal-net `Error::prioritize_error`): a key
// that was found but did not open the token over a failed connection, and "no data" only when nothing else happened
const REASON_PRIORITY: SvrBErrorReason[] = [
  'invalidData', 'decryptionFailed', 'protocolError', 'rateLimited', 'unavailable', 'restoreFailed', 'dataMissing',
];

/**
 * The state that starts a chain of backups, for an account that has none (libsignal-net
 * `create_new_backup_chain`). It makes no request.
 */
export function createNewBackupChain(backupKey: Uint8Array) {
  return wasm.SecureValueRecoveryForBackups_CreateNewBackupChain(backupKey);
}

/**
 * Prepares the key of a new backup file and puts the key of the previous one into the enclaves (libsignal-net
 * `store_backup`): the file's token is encrypted under the previous and the next key, so it opens whichever the
 * enclaves hold. Nothing is final until the caller keeps `nextBackupData`, after the file is uploaded.
 */
export async function storeBackup(
  credentials: Credentials, backupKey: Uint8Array, previousSecretData: Uint8Array,
): Promise<StoreResult> {
  let response: wasm.BackupStoreResponse | undefined;
  try {
    response = wasm.SecureValueRecoveryForBackups_PrepareStore(backupKey, previousSecretData);
    const finalizeRequest = wasm.BackupStoreResponse_GetFinalizeRequest(response);
    // After a restore the enclaves hold the key already
    if (finalizeRequest.length) {
      // Every current enclave gets the same request (libsignal-net `store_backup`)
      await Promise.all(SIGNAL_SVRB_MRENCLAVES.map(
        (mrenclave) => withConnection(credentials, mrenclave, (connection) => connection.exchange(finalizeRequest)),
      ));
    }
    return {
      forwardSecrecyToken: wasm.BackupStoreResponse_GetForwardSecrecyToken(response),
      metadata: wasm.BackupStoreResponse_GetOpaqueMetadata(response),
      nextBackupData: wasm.BackupStoreResponse_GetNextBackupSecretData(response),
    };
  } catch (err) {
    throw toSvrBError(err);
  } finally {
    response?.free();
  }
}

/**
 * Gets the token of a backup file from its metadata (libsignal-net `restore_backup`): each enclave is asked for the key
 * of each pair of the metadata, the oldest pair first, since that is the one in the enclave after a store.
 */
export async function restoreBackup(
  credentials: Credentials, backupKey: Uint8Array, metadata: Uint8Array,
): Promise<RestoreResult> {
  let salts: Uint8Array;
  try {
    salts = wasm.SecureValueRecoveryForBackups_GetMetadataSalts(metadata);
  } catch (err) {
    throw toSvrBError(err);
  }

  let failure: SvrBError | undefined;
  for (const mrenclave of SIGNAL_SVRB_MRENCLAVES) {
    for (let pairIndex = 0; pairIndex * SALT_LENGTH < salts.length; pairIndex++) {
      const salt = salts.subarray(pairIndex * SALT_LENGTH, (pairIndex + 1) * SALT_LENGTH);
      try {
        const encryptionSalt = await withConnection(credentials, mrenclave, (connection) => restoreKey(
          connection, backupKey, salt,
        ));
        const response = wasm.SecureValueRecoveryForBackups_FinishRestore(
          backupKey, metadata, pairIndex, encryptionSalt,
        );
        try {
          return {
            forwardSecrecyToken: wasm.BackupRestoreResponse_GetForwardSecrecyToken(response),
            nextBackupData: wasm.BackupRestoreResponse_GetNextBackupSecretData(response),
          };
        } finally {
          response.free();
        }
      } catch (err) {
        // An enclave that answers 404 is `unavailable` as well: it may be the one that holds the key, so a chain must not
        // start over it (libsignal-net `restore_backup` counts every connection failure)
        failure = prioritize(failure, toSvrBError(err));
      }
    }
  }
  throw failure ?? new SvrBError('unavailable');
}

/** Deletes the key of the backup from the enclaves (libsignal-net `remove_backup`); a connection that fails is skipped */
export async function removeBackup(credentials: Credentials) {
  const request = wasm.SvrBRemove_GetRequest();
  const results = await Promise.allSettled(SIGNAL_SVRB_MRENCLAVES.map(
    (mrenclave) => withConnection(credentials, mrenclave, (connection) => connection.exchange(request)),
  ));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure && !isEnclaveNotFound(failure.reason)) throw toSvrBError(failure.reason);
}

/** The tries that the current enclave has left for the backup, which changes nothing there (libsignal `Query4`) */
export async function queryBackup(credentials: Credentials) {
  try {
    const response = await withConnection(
      credentials, SIGNAL_SVRB_MRENCLAVES[0], (connection) => connection.exchange(wasm.SvrBQuery_GetRequest()),
    );
    return wasm.SvrBQuery_Finalize(response);
  } catch (err) {
    throw toSvrBError(err);
  }
}

/**
 * The two requests of a restore on one connection, which the second request's proof binds to. A step that takes the
 * state over (`SvrBRestore1_Restore2`, `SvrBRestore2_Restore`) frees it; a request that fails before it leaves the
 * state to free here.
 */
async function restoreKey(connection: SvrBConnection, backupKey: Uint8Array, salt: Uint8Array) {
  const restore1 = wasm.SvrBRestore1_New(backupKey, salt);
  let response1;
  try {
    response1 = await connection.exchange(wasm.SvrBRestore1_GetRequest(restore1));
  } catch (err) {
    restore1.free();
    throw err;
  }
  const restore2 = wasm.SvrBRestore1_Restore2(restore1, response1, connection.getHandshakeHash());

  let response2;
  try {
    response2 = await connection.exchange(wasm.SvrBRestore2_GetRequest(restore2));
  } catch (err) {
    restore2.free();
    throw err;
  }
  return wasm.SvrBRestore2_Restore(restore2, response2);
}

class SvrBConnection {
  constructor(private connection: AttestedConnection) {}

  /** Sends one request and returns the answer */
  async exchange(request: Uint8Array) {
    this.connection.send(request);
    const response = await this.connection.receive();
    if (!response) throw new SvrBError('protocolError');
    return response;
  }

  getHandshakeHash() {
    return this.connection.getHandshakeHash();
  }
}

/**
 * Runs `callback` on a new attested connection to an enclave, as the Signal clients do for each operation. The token
 * does not name the account, so the connection takes the tunnel without credentials (`GET /v1/archives/auth/svrb`
 * refuses an authenticated connection).
 */
async function withConnection<T>(
  credentials: Credentials, mrenclave: string, callback: (connection: SvrBConnection) => Promise<T>,
) {
  const mrenclaveBytes = bufferFromHex(mrenclave);
  const connection = await AttestedConnection.connect(
    SIGNAL_SVRB_HOST,
    `/v1/${mrenclave}`,
    'unauthenticated',
    credentials,
    (attestation, now) => wasm.SvrBClient_New(mrenclaveBytes, attestation, now),
  );
  try {
    return await callback(new SvrBConnection(connection));
  } finally {
    connection.close();
  }
}

function isEnclaveNotFound(err: unknown) {
  return err instanceof WebSocketConnectError && err.status === HTTP_NOT_FOUND;
}

function toSvrBError(err: unknown): SvrBError {
  if (err instanceof SvrBError) return err;
  if (err instanceof WebSocketConnectError && err.status === HTTP_TOO_MANY_REQUESTS) {
    return new SvrBError('rateLimited', err);
  }
  const reason = ERROR_REASONS[(err as { libsignalName?: string } | undefined)?.libsignalName ?? ''];
  // The tries that are left after a wrong key do not matter: the key is gone for good
  return new SvrBError(reason ?? 'unavailable', err);
}

function prioritize(first: SvrBError | undefined, second: SvrBError) {
  if (!first) return second;
  return REASON_PRIORITY.indexOf(first.reason) <= REASON_PRIORITY.indexOf(second.reason) ? first : second;
}
