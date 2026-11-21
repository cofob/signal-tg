import type MessageProcessor from '../messages/MessageProcessor';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord, HistoryTransferState } from '../store/SignalStore';
import type { BackupImportResult } from './importBackup';

import { pause } from '../../../util/schedulers';
import { deriveMessageBackupKeys, readBackupFrames } from './backupStream';
import { importBackupFrames } from './importBackup';
import { downloadTransferArchive, waitForTransferArchive } from './transferArchive';

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

/**
 * Link and sync (Signal Desktop `BackupsService.downloadAndImport` in `ts/services/backups/index.preload.ts`): waits
 * for the primary device to upload the message history, downloads, decrypts and imports it. It runs once after
 * linking, before the chat socket connects, so messages sent meanwhile wait on the server and arrive after the
 * history. The archive location and import progress live in the account, so a closed tab resumes the transfer
 * without importing anything twice. The transfer state goes once the transfer ends, failed or not; an abort keeps it.
 */
export async function transferHistory(
  store: SignalStore,
  processor: MessageProcessor,
  onProgress: (progress: HistoryTransferProgress) => void,
  signal: AbortSignal,
): Promise<HistoryTransferOutcome> {
  try {
    return await runTransfer(store, processor, onProgress, signal);
  } finally {
    if (!signal.aborted) {
      await updateStoredAccount(store, { historyTransfer: undefined, ephemeralBackupKey: undefined });
    }
  }
}

async function runTransfer(
  store: SignalStore,
  processor: MessageProcessor,
  onProgress: (progress: HistoryTransferProgress) => void,
  signal: AbortSignal,
): Promise<HistoryTransferOutcome> {
  let account = (await store.getItem('account'))!;
  let state: HistoryTransferState = account.historyTransfer ?? {};

  if (!state.archive) {
    onProgress({ step: 'waiting' });
    const response = await retry(() => waitForTransferArchive(account, signal), signal);
    if ('error' in response) {
      return response.error === 'RELINK_REQUESTED' ? { type: 'relink' } : { type: 'skipped' };
    }
    state = { ...state, archive: { cdn: response.cdn, key: response.key } };
    account = await updateStoredAccount(store, { historyTransfer: state });
  }

  onProgress({ step: 'downloading', progress: 0 });
  const archive = await retry(() => downloadTransferArchive(state.archive!, (receivedLength, totalLength) => {
    onProgress({ step: 'downloading', progress: receivedLength / totalLength });
  }, signal), signal);
  if (!archive) return { type: 'skipped' };

  onProgress({ step: 'importing', progress: 0 });
  const result = await importBackupArchive(archive, account.ephemeralBackupKey!, {
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

/** Decrypts and imports a backup encrypted with `backupKey`; `signalDev.importHistory` uses it directly */
export async function importBackupArchive(
  archive: Uint8Array<ArrayBuffer>,
  backupKey: Uint8Array,
  options: {
    store: SignalStore;
    processor: MessageProcessor;
    account: AccountRecord;
    skipItemCount?: number;
    onProgress?: (progress: number) => void;
    onBatchStored?: (importedItemCount: number) => Promise<void>;
  },
) {
  const {
    store, processor, account, skipItemCount, onProgress, onBatchStored,
  } = options;
  const keys = deriveMessageBackupKeys(backupKey, account.aci);
  const frames = readBackupFrames(archive, keys, (readLength, totalLength) => onProgress?.(readLength / totalLength));
  return importBackupFrames(frames, {
    store,
    processor,
    account,
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

/** The transfer runs before the client connects, so it writes the stored account directly */
async function updateStoredAccount(store: SignalStore, update: Partial<AccountRecord>) {
  const account = { ...(await store.getItem('account'))!, ...update };
  await store.setItem('account', account);
  return account;
}
