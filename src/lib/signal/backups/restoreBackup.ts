import type MessageProcessor from '../messages/MessageProcessor';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord } from '../store/SignalStore';
import type { BackupImportResult } from './importBackup';

import { buffersEqual } from '../../../util/encoding/buffer';
import { wasm } from '../wasm';
import {
  ArchiveError, downloadArchive, getArchiveAuth, getArchiveFileInfo, getArchiveInfo, getArchiveReadHeaders,
} from './archiveApi';
import { deriveMessageBackupKeys, ForwardSecrecyBackupError, hasForwardSecrecyHeader } from './backupStream';
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
  // The backup holds forward secrecy metadata, which only SVR-B can open
  | 'needsForwardSecrecy'
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
  signal?: AbortSignal;
  onProgress?(progress: RestoreProgress): void;
};

/** What the backup service holds for a recovery key, before anything is downloaded */
export type RemoteBackupSummary = {
  size: number;
  // Milliseconds since the epoch
  modifiedAt?: number;
};

/**
 * Looks for the backup of a recovery key on the backup service, for a registration (Signal Android
 * `verifyBackupKeyAssociatedWithAccount`, `getRemoteBackupInfo`): the credentials of the account only fit the key
 * that the account's backup id came from. A new account has no backup id, and the key then reserves it.
 */
export async function findRemoteBackup(
  { store, account, accountEntropyPool }: Pick<RestoreOptions, 'store' | 'account' | 'accountEntropyPool'>,
): Promise<RemoteBackupSummary> {
  if (!wasm.AccountEntropyPool_IsValid(accountEntropyPool)) throw new RestoreError('invalidKey');
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
 * Restores the backup of the recovery key from the backup service: downloads the encrypted file, checks its MAC and
 * validates it with libsignal, and imports it with the importer of link and sync. The account takes the recovery key
 * (`adoptRecoveryKey`) once the import is done.
 */
export async function restoreRemoteBackup(options: RestoreOptions): Promise<BackupImportResult> {
  const {
    store, account, accountEntropyPool, signal, onProgress,
  } = options;
  onProgress?.({ step: 'verifying' });
  if (!wasm.AccountEntropyPool_IsValid(accountEntropyPool)) throw new RestoreError('invalidKey');
  const keys = getRestoreKeys(account, accountEntropyPool);

  let archive;
  try {
    const auth = await getArchiveAuth(store, account, keys, 'messages');
    const info = await getArchiveInfo(auth);
    const readHeaders = await getArchiveReadHeaders(auth, info.cdn);
    onProgress?.({ step: 'downloading', progress: 0 });
    archive = await downloadArchive(info, readHeaders, {
      signal,
      onProgress: (received, total) => onProgress?.({ step: 'downloading', progress: total ? received / total : 1 }),
    });
  } catch (err) {
    throw toRestoreError(err);
  }
  if (!archive) throw new RestoreError('noBackup');
  return importArchive(archive, options);
}

/** Restores a backup file that a user kept (`BackupService` writes the same file that goes to the service) */
export function restoreBackupFile(archive: Uint8Array<ArrayBuffer>, options: RestoreOptions) {
  if (!wasm.AccountEntropyPool_IsValid(options.accountEntropyPool)) throw new RestoreError('invalidKey');
  return importArchive(archive, options);
}

/**
 * Makes the recovery key of a restored backup the account's: its backup key, its storage key and its recovery
 * password come from it. An account that a PIN restored keeps its master key, which has to be the key's own.
 */
export async function adoptRecoveryKey(store: SignalStore, account: AccountRecord, accountEntropyPool: string) {
  const svrKey = wasm.AccountEntropyPool_DeriveSvrKey(accountEntropyPool);
  if (account.masterKey && !buffersEqual(account.masterKey, svrKey)) throw new RestoreError('wrongKey');

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
 * The keys of a restore: the media root key of a new account is not the backup's, which the header of the backup
 * brings, so the account has none during the import and only the messages credential is asked for
 */
function getRestoreKeys(account: AccountRecord, accountEntropyPool: string) {
  return getArchiveKeys({ ...account, accountEntropyPool, mediaRootBackupKey: undefined });
}

async function importArchive(archive: Uint8Array<ArrayBuffer>, options: RestoreOptions) {
  const {
    store, processor, accountEntropyPool, onProgress,
  } = options;
  const account = { ...options.account, mediaRootBackupKey: undefined };
  if (hasForwardSecrecyHeader(archive)) throw new RestoreError('needsForwardSecrecy');

  try {
    const backupKey = wasm.AccountEntropyPool_DeriveBackupKey(accountEntropyPool);
    onProgress?.({ step: 'validating' });
    // A wrong key shows as a MAC that does not match
    await validateBackupFile(archive, deriveMessageBackupKeys(backupKey, account.aci));

    onProgress?.({ step: 'importing', progress: 0 });
    const result = await importBackupArchive(archive, backupKey, {
      store,
      processor,
      account,
      onProgress: (progress) => onProgress?.({ step: 'importing', progress }),
    });
    return result;
  } catch (err) {
    if (err instanceof ForwardSecrecyBackupError) throw new RestoreError('needsForwardSecrecy');
    throw new RestoreError('invalidBackup', undefined, { cause: err });
  }
}

function toRestoreError(err: unknown) {
  if (err instanceof RestoreError) return err;
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
