import type { ApiBackupSettings } from '../../types';

import BackupService from '../../../lib/signal/backups/BackupService';
import { SIGNAL_PRIMARY_DEVICE_ID } from '../../../lib/signal/config';
import { backups, store } from '../engine';
import { sendApiUpdate } from '../updates';

/** The settings of Signal Secure Backups with the state of the backup that is running */
export async function buildBackupSettings(): Promise<ApiBackupSettings | undefined> {
  const account = await store.getItem('account');
  if (!account) return undefined;

  const settings = account.backups;
  return {
    unavailableReason: BackupService.getUnavailableReason(account),
    isPrimary: account.deviceId === SIGNAL_PRIMARY_DEVICE_ID,
    isEnabled: Boolean(settings?.isEnabled),
    frequency: settings?.frequency ?? 'daily',
    lastBackupAt: settings?.lastBackupAt,
    lastBackupSize: settings?.lastBackupSize,
    tier: settings?.tier,
    lastError: settings?.lastError,
    isRunning: backups.isBackingUp || undefined,
    progress: backups.progress,
  };
}

/** Tells the app that the settings or the state of a backup changed */
export async function handleBackupChange() {
  const settings = await buildBackupSettings();
  if (settings) sendApiUpdate({ '@type': 'updateBackupSettings', settings });
}
