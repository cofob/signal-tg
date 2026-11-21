import type MessageProcessor from '../messages/MessageProcessor';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord, HistoryTransferState } from '../store/SignalStore';
import type { MessageBackupKeys } from './backupStream';
import type { BackupImportResult } from './importBackup';

import { pause } from '../../../util/schedulers';
import { HttpError } from '../net/rest';
import { deriveMessageBackupKeys, readBackupFrames } from './backupStream';
import { importBackupFrames } from './importBackup';
import { downloadTransferArchive, TransferArchiveTimeoutError, waitForTransferArchive } from './transferArchive';

export type HistoryTransferProgress = {
  step: 'waiting' | 'downloading' | 'importing';
  // From 0 to 1, while downloading and importing
  progress?: number;
};

export type HistoryTransferOutcome =
  { type: 'imported'; result: BackupImportResult }
  // The primary device uploaded nothing, or the archive is gone
  | { type: 'skipped' }
  // The primary device failed to export and asks to link again
  | { type: 'relink' };

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const HTTP_SERVER_ERROR = 500;

/**
 * Link and sync (Signal Desktop `BackupsService.downloadAndImport` in `ts/services/backups/index.preload.ts`): waits
 * for the primary device to upload the message history, downloads, decrypts and imports it. It runs once after
 * linking, before the chat socket connects, so messages sent meanwhile wait on the server and arrive after the
 * history. The archive location and import progress live in the account, so a closed tab resumes the transfer
 * without importing anything twice. The transfer state goes once the transfer ends. It stays after an abort and
 * after a failure of the network or the servers, so the next start tries again; it goes after an archive that fails
 * to decrypt or import and after a wait that timed out.
 */
export async function transferHistory(
  store: SignalStore,
  processor: MessageProcessor,
  onProgress: (progress: HistoryTransferProgress) => void,
  signal: AbortSignal,
): Promise<HistoryTransferOutcome> {
  const failure = { isTransient: false };
  let outcome;
  try {
    outcome = await runTransfer(store, processor, onProgress, signal, failure);
  } catch (err) {
    if (!signal.aborted && !failure.isTransient) await clearTransferState(store);
    throw err;
  }
  await clearTransferState(store);
  return outcome;
}

/** `failure.isTransient` tells `transferHistory` whether a thrown error may pass on a later start */
async function runTransfer(
  store: SignalStore,
  processor: MessageProcessor,
  onProgress: (progress: HistoryTransferProgress) => void,
  signal: AbortSignal,
  failure: { isTransient: boolean },
): Promise<HistoryTransferOutcome> {
  let account = (await store.getItem('account'))!;
  let state: HistoryTransferState = account.historyTransfer ?? {};

  if (!state.archive) {
    onProgress({ step: 'waiting' });
    const response = await retry(() => waitForTransferArchive(account, signal), signal).catch(noteTransient(failure));
    if ('error' in response) {
      return response.error === 'RELINK_REQUESTED' ? { type: 'relink' } : { type: 'skipped' };
    }
    state = { ...state, archive: { cdn: response.cdn, key: response.key } };
    account = await updateStoredAccount(store, { historyTransfer: state });
  }

  onProgress({ step: 'downloading', progress: 0 });
  const archive = await retry(() => downloadTransferArchive(state.archive!, (receivedLength, totalLength) => {
    onProgress({ step: 'downloading', progress: receivedLength / totalLength });
  }, signal), signal).catch(noteTransient(failure));
  if (!archive) return { type: 'skipped' };

  onProgress({ step: 'importing', progress: 0 });
  const result = await importBackupArchive(archive, deriveMessageBackupKeys(account.ephemeralBackupKey!, account.aci), {
    store,
    processor,
    account,
    skipItemCount: state.importedItemCount ?? 0,
    onProgress: (progress) => onProgress({ step: 'importing', progress }),
    onBatchStored: async (importedItemCount) => {
      signal.throwIfAborted();
      state = { ...state, importedItemCount };
      await updateStoredAccount(store, { historyTransfer: state });
    },
  });
  return { type: 'imported', result };
}

/** Decrypts and imports a backup that `keys` open; `signalDev.importHistory` uses it directly */
export async function importBackupArchive(
  archive: Uint8Array<ArrayBuffer>,
  keys: MessageBackupKeys,
  options: {
    store: SignalStore;
    processor: MessageProcessor;
    account: AccountRecord;
    // The account is in use: the backup adds to it and does not overwrite what it has
    isMerge?: boolean;
    skipItemCount?: number;
    onProgress?: (progress: number) => void;
    onBatchStored?: (importedItemCount: number) => Promise<void>;
  },
) {
  const {
    store, processor, account, isMerge, skipItemCount, onProgress, onBatchStored,
  } = options;
  const frames = readBackupFrames(archive, keys, (readLength, totalLength) => onProgress?.(readLength / totalLength));
  return importBackupFrames(frames, {
    store,
    processor,
    account,
    isMerge,
    skipItemCount: skipItemCount ?? 0,
    updateAccount: async (update) => {
      await updateStoredAccount(store, update);
    },
    onBatchStored: onBatchStored ?? (() => Promise.resolve()),
  });
}

/** Retries network steps that fail, unless the transfer was aborted */
async function retry<T>(callback: () => Promise<T>, signal: AbortSignal) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callback();
    } catch (err) {
      if (signal.aborted || attempt === MAX_ATTEMPTS) throw err;
      await pause(RETRY_DELAY_MS);
    }
  }
}

/** Notes on `failure` whether the error of a network step may pass; the step's error is thrown on */
function noteTransient(failure: { isTransient: boolean }) {
  return (err: unknown): never => {
    failure.isTransient = !(err instanceof TransferArchiveTimeoutError)
      && !(err instanceof HttpError && err.status < HTTP_SERVER_ERROR);
    throw err;
  };
}

function clearTransferState(store: SignalStore) {
  return updateStoredAccount(store, { historyTransfer: undefined, ephemeralBackupKey: undefined });
}

/** The transfer runs before the client connects, so it writes the stored account directly */
async function updateStoredAccount(store: SignalStore, update: Partial<AccountRecord>) {
  const account = { ...(await store.getItem('account'))!, ...update };
  await store.setItem('account', account);
  return account;
}
