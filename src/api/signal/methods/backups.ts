import type { ApiBackupFrequency, ApiBackupRemoteStatus, ApiBackupSettings } from '../../types';

import { normalizeRecoveryKey } from '../../../lib/signal/account/recoveryKey';
import { ArchiveError } from '../../../lib/signal/backups/archiveApi';
import BackupService from '../../../lib/signal/backups/BackupService';
import { restoreBackupFile, RestoreError } from '../../../lib/signal/backups/restoreBackup';
import { BackupValidationError } from '../../../lib/signal/backups/validateBackup';
import NetworkError from '../../../lib/signal/net/NetworkError';
import { backups, logError, processor, store } from '../engine';
import { buildBackupSettings } from '../updaters/backups';

// The reasons that an action of the backup settings fails, which the app shows as a notification
export type BackupErrorReason =
  | 'unavailable' | 'rateLimited' | 'network' | 'notEnabledOnPrimary' | 'invalidBackup' | 'wrongKey' | 'invalidKey'
  | 'needsForwardSecrecy' | 'failed';

const BACKUP_FILE_PREFIX = 'signal-backup';
const ISO_DATE_LENGTH = 10;

export function fetchBackupSettings() {
  return buildBackupSettings();
}

/**
 * What the backup service holds for the account, from requests that change nothing; `undefined` when the account
 * cannot use backups or the service did not answer
 */
export async function fetchBackupRemoteStatus(): Promise<ApiBackupRemoteStatus | undefined> {
  try {
    const account = await store.getItem('account');
    if (!account || BackupService.getUnavailableReason(account)) return undefined;
    // An account that never had a backup has no backup id for the service to find
    if (!account.backups?.isEnabled) return undefined;
    return await backups.fetchRemoteStatus();
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/** Turns backups on and makes the first backup; resolves with the reason when it failed */
export function enableBackups(frequency: ApiBackupFrequency) {
  return runAction(() => backups.enable(frequency));
}

export function disableBackups(shouldDeleteBackup?: boolean) {
  return runAction(() => backups.disable(shouldDeleteBackup));
}

export function setBackupFrequency(frequency: ApiBackupFrequency) {
  return runAction(() => backups.setFrequency(frequency));
}

/** Makes a backup now; a backup that is running or one that was canceled resolves without a reason */
export function backUpNow() {
  return runAction(async () => {
    await backups.backUp();
  });
}

export function cancelBackup() {
  backups.cancelBackup();
}

/** The backup as a file to keep: the file that goes to the backup service, which the recovery key opens */
export async function exportBackupFile() {
  try {
    const { file } = await backups.exportToFile();
    const date = new Date().toISOString().slice(0, ISO_DATE_LENGTH);
    return { fileName: `${BACKUP_FILE_PREFIX}-${date}.backup`, data: file };
  } catch (err) {
    logError(err);
    return { error: getErrorReason(err) };
  }
}

/** Imports a backup file that the recovery key opens into this account; resolves with the number of messages */
export async function importBackupFile(data: Uint8Array<ArrayBuffer>, recoveryKey: string) {
  try {
    const account = await store.getItem('account');
    if (!account) return { error: 'failed' as const };
    const result = await restoreBackupFile(data, {
      store, processor, account, accountEntropyPool: normalizeRecoveryKey(recoveryKey),
    });
    return { messageCount: result.messageCount };
  } catch (err) {
    logError(err);
    return { error: getErrorReason(err) };
  }
}

/** Runs a settings action: resolves with the settings after it, or the reason that it failed */
async function runAction(action: () => Promise<unknown>): Promise<ApiBackupSettings | { error: BackupErrorReason }> {
  try {
    await action();
  } catch (err) {
    // A canceled backup is no failure
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      logError(err);
      return { error: getErrorReason(err) };
    }
  }
  return (await buildBackupSettings())!;
}

function getErrorReason(err: unknown): BackupErrorReason {
  if (err instanceof RestoreError) return err.reason === 'noBackup' ? 'failed' : err.reason;
  if (err instanceof BackupValidationError) return 'invalidBackup';
  if (err instanceof ArchiveError) {
    if (err.kind === 'rateLimited') return 'rateLimited';
    if (err.kind === 'notFound') return 'notEnabledOnPrimary';
    return 'network';
  }
  if (err instanceof NetworkError) return 'network';
  return err instanceof Error && err.message.startsWith('Backups are not available') ? 'unavailable' : 'failed';
}
