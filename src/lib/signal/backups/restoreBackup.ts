import type MessageProcessor from '../messages/MessageProcessor';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord } from '../store/SignalStore';
import type { BackupImportResult } from './importBackup';

import { buffersEqual } from '../../../util/encoding/buffer';
import { restoreBackup, SvrBError } from '../svr/svrb';
import { wasm } from '../wasm';
import {
  ArchiveError, downloadArchive, getArchiveAuth, getArchiveFileInfo, getArchiveInfo, getArchiveReadHeaders,
  getSvrBCredentials,
} from './archiveApi';
import { deriveMessageBackupKeys, readForwardSecrecyMetadata } from './backupStream';
import { importBackupArchive } from './transferHistory';
import { validateBackupFile } from './validateBackup';

import { getArchiveKeys } from './BackupService';

export type RestoreStep = 'verifying' | 'downloading' | 'validating' | 'importing';

export type RestoreProgress = {
  step: RestoreStep;
  // From 0 to 1, while downloading and importing
  progress?: number;
};

export type RestoreFailureReason =
  // The recovery key is not an account entropy pool, or it is not the one of this account
  | 'invalidKey'
  | 'wrongKey'
  | 'noBackup'
  // The enclaves of SVR-B do not hold the key that the backup's token is under: nothing opens it anymore
  | 'forwardSecrecyLost'
  | 'invalidBackup'
  | 'rateLimited'
  | 'network';

export class RestoreError extends Error {
  constructor(readonly reason: RestoreFailureReason, readonly retryAfterSeconds?: number, options?: ErrorOptions) {
    super(`Backup restore failed: ${reason}`, options);
  }
}

type RestoreOptions = {
  store: SignalStore;
  processor: MessageProcessor;
  // The account that restores, with the recovery key that its backup was made with
  account: AccountRecord;
  accountEntropyPool: string;
  // A restore into an account that is in use: what the account has stays, and the backup adds to it. Without it the
  // account is a new registration, which the backup fills.
  isMerge?: boolean;
  signal?: AbortSignal;
  onProgress?(progress: RestoreProgress): void;
};

/** What the backup service holds for a recovery key, before anything is downloaded */
export type RemoteBackupSummary = {
  size: number;
  // Milliseconds since the epoch
  modifiedAt?: number;
};

/** The token that opens a backup from the archive CDN, with the file's metadata that SVR-B answered for */
type ForwardSecrecy = {
  metadata: Uint8Array;
  token: Uint8Array;
  // The chain of backups continues from the restored key, which a new account keeps for its first backup
  nextBackupData: Uint8Array;
};

/**
 * Looks for the backup of a recovery key on the backup service, for a registration (Signal Android
 * `verifyBackupKeyAssociatedWithAccount`, `getRemoteBackupInfo`): the credentials of the account only fit the key
 * that the account's backup id came from. The look changes nothing: a new account that has no backup id gets none.
 */
export async function findRemoteBackup(
  { store, account, accountEntropyPool }: Pick<RestoreOptions, 'store' | 'account' | 'accountEntropyPool'>,
): Promise<RemoteBackupSummary> {
  checkRecoveryKey(account, accountEntropyPool);
  const keys = getRestoreKeys(account, accountEntropyPool);

  try {
    const auth = await getArchiveAuth(store, account, keys, 'messages');
    const info = await getArchiveInfo(auth);
    const file = await getArchiveFileInfo(info, await getArchiveReadHeaders(auth, info.cdn));
    if (!file) throw new RestoreError('noBackup');
    return { size: file.size, modifiedAt: file.modifiedAt };
  } catch (err) {
    throw toRestoreError(err);
  }
}

/**
 * Restores the backup of the recovery key from the backup service: SVR-B gives the token of the file from its
 * header, then the encrypted file is downloaded, its MAC checked, and libsignal validates it, and the importer of
 * link and sync imports it. The account takes the recovery key (`adoptRecoveryKey`) once the import is done.
 */
export async function restoreRemoteBackup(options: RestoreOptions): Promise<BackupImportResult> {
  const {
    store, account, accountEntropyPool, signal, onProgress,
  } = options;
  onProgress?.({ step: 'verifying' });
  checkRecoveryKey(account, accountEntropyPool);
  const keys = getRestoreKeys(account, accountEntropyPool);

  let archive;
  let forwardSecrecy;
  try {
    const auth = await getArchiveAuth(store, account, keys, 'messages');
    const info = await getArchiveInfo(auth);
    const readHeaders = await getArchiveReadHeaders(auth, info.cdn);
    // The start of the file says whether it is in the format of SVR-B before the whole file is downloaded
    const file = await getArchiveFileInfo(info, readHeaders);
    if (!file) throw new RestoreError('noBackup');
    const metadata = readForwardSecrecyMetadata(file.start);
    if (metadata) forwardSecrecy = await getForwardSecrecy(await getSvrBCredentials(auth), keys.backupKey, metadata);

    signal?.throwIfAborted();
    onProgress?.({ step: 'downloading', progress: 0 });
    archive = await downloadArchive(info, readHeaders, {
      signal,
      onProgress: (received, total) => onProgress?.({ step: 'downloading', progress: total ? received / total : 1 }),
    });
  } catch (err) {
    throw toRestoreError(err);
  }
  if (!archive) throw new RestoreError('noBackup');
  return importArchive(archive, options, forwardSecrecy);
}

/**
 * Restores a backup file that a user kept (`BackupService` writes a file without forward secrecy for the user; a file
 * that was downloaded from the backup service has the header, and SVR-B opens it as it does for the service)
 */
export async function restoreBackupFile(archive: Uint8Array<ArrayBuffer>, options: RestoreOptions) {
  const { store, account, accountEntropyPool } = options;
  checkRecoveryKey(account, accountEntropyPool);

  let forwardSecrecy;
  const metadata = readHeader(archive);
  if (metadata) {
    const keys = getRestoreKeys(account, accountEntropyPool);
    try {
      const auth = await getArchiveAuth(store, account, keys, 'messages');
      forwardSecrecy = await getForwardSecrecy(await getSvrBCredentials(auth), keys.backupKey, metadata);
    } catch (err) {
      throw toRestoreError(err);
    }
  }
  return importArchive(archive, options, forwardSecrecy);
}

/**
 * Makes the recovery key of a restored backup the account's: its backup key, its storage key and its recovery
 * password come from it. The account is read again, since the import changed it.
 */
export async function adoptRecoveryKey(store: SignalStore, accountEntropyPool: string) {
  const account = (await store.getItem('account'))!;
  const updated: AccountRecord = {
    ...account,
    accountEntropyPool,
    // The recovery key of a new account was never shown to the user, and the restored one is theirs already
    isRecoveryKeyUnconfirmed: undefined,
  };
  await store.setItem('account', updated);
  return updated;
}

/**
 * Checks the recovery key against what the account has, before anything is downloaded or imported: an account that
 * a PIN restored keeps its master key, which has to be the key's own, and an account in use has its recovery key.
 * The made-up key of a new registration is not the account's.
 */
function checkRecoveryKey(account: AccountRecord, accountEntropyPool: string) {
  if (!wasm.AccountEntropyPool_IsValid(accountEntropyPool)) throw new RestoreError('invalidKey');
  if (account.masterKey && !buffersEqual(account.masterKey, wasm.AccountEntropyPool_DeriveSvrKey(accountEntropyPool))) {
    throw new RestoreError('wrongKey');
  }
  const hasOwnKey = account.accountEntropyPool && !account.isRecoveryKeyUnconfirmed;
  if (hasOwnKey && account.accountEntropyPool !== accountEntropyPool) throw new RestoreError('wrongKey');
}

/**
 * The keys of a restore: the media root key of a new account is not the backup's, which the header of the backup
 * brings, so the account has none during the import and only the messages credential is asked for
 */
function getRestoreKeys(account: AccountRecord, accountEntropyPool: string) {
  return getArchiveKeys({ ...account, accountEntropyPool, mediaRootBackupKey: undefined });
}

/** The metadata of the file's header, if it has one; a header that cannot be read is a damaged backup */
function readHeader(archive: Uint8Array) {
  try {
    return readForwardSecrecyMetadata(archive);
  } catch (err) {
    throw new RestoreError('invalidBackup', undefined, { cause: err });
  }
}

/** Asks SVR-B for the token of the file named by its metadata (Signal Android `restoreRemoteBackup`) */
async function getForwardSecrecy(
  credentials: { username: string; password: string }, backupKey: Uint8Array, metadata: Uint8Array,
): Promise<ForwardSecrecy> {
  try {
    const { forwardSecrecyToken, nextBackupData } = await restoreBackup(credentials, backupKey, metadata);
    return { metadata, token: forwardSecrecyToken, nextBackupData };
  } catch (err) {
    if (!(err instanceof SvrBError)) throw err;
    switch (err.reason) {
      // The enclaves answered that the key of the file is gone, or they answered with something unusable: Android
      // takes either as a failure that retrying does not mend
      case 'dataMissing':
      case 'restoreFailed':
      case 'decryptionFailed':
        throw new RestoreError('forwardSecrecyLost', undefined, { cause: err });
      case 'invalidData':
        throw new RestoreError('invalidBackup', undefined, { cause: err });
      case 'rateLimited':
        throw new RestoreError('rateLimited', undefined, { cause: err });
      default:
        throw new RestoreError('network', undefined, { cause: err });
    }
  }
}

async function importArchive(
  archive: Uint8Array<ArrayBuffer>, options: RestoreOptions, forwardSecrecy?: ForwardSecrecy,
) {
  const {
    store, processor, accountEntropyPool, isMerge, onProgress,
  } = options;
  // Outside a merge, the media root key of the backup replaces the one of the new account
  const account = isMerge ? options.account : { ...options.account, mediaRootBackupKey: undefined };

  const metadata = readHeader(archive);
  // The file is not the one that the token came for when the service replaced it meanwhile
  if (metadata && !(forwardSecrecy && buffersEqual(forwardSecrecy.metadata, metadata))) {
    throw new RestoreError('network');
  }

  try {
    const backupKey = wasm.AccountEntropyPool_DeriveBackupKey(accountEntropyPool);
    const keys = deriveMessageBackupKeys(backupKey, account.aci, metadata && forwardSecrecy?.token);
    onProgress?.({ step: 'validating' });
    // A wrong key shows as a MAC that does not match
    await validateBackupFile(archive, keys);

    options.signal?.throwIfAborted();
    onProgress?.({ step: 'importing', progress: 0 });
    const result = await importBackupArchive(archive, keys, {
      store,
      processor,
      account,
      isMerge,
      onProgress: (progress) => onProgress?.({ step: 'importing', progress }),
    });
    // A new account continues the chain of the backup from the key that the restore opened. An account in use has its
    // own chain, which an older file does not replace.
    if (forwardSecrecy && !isMerge) await store.setItem('svrbBackupData', forwardSecrecy.nextBackupData);
    return result;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new RestoreError('invalidBackup', undefined, { cause: err });
  }
}

function toRestoreError(err: unknown) {
  if (err instanceof RestoreError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') return err;
  if (err instanceof ArchiveError) {
    switch (err.kind) {
      case 'verificationFailed':
      case 'unauthorized':
        return new RestoreError('wrongKey');
      case 'notFound':
        return new RestoreError('noBackup');
      case 'rateLimited':
        return new RestoreError('rateLimited', err.retryAfterSeconds);
      default:
        return new RestoreError('network', undefined, { cause: err });
    }
  }
  return new RestoreError('network', undefined, { cause: err });
}
