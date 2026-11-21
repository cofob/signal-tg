import type { ApiBackupSettings } from '../../../api/types';
import type { RegularLangKey } from '../../../types/language';

import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import download from '../../../util/download';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { saveFile } from '../../../util/tauri/nativeFiles';
import { callApi } from '../../../api';
import {
  addActionHandler, getActions, getGlobal, getPromiseActions, setGlobal,
} from '../../index';
import { replaceSettings } from '../../reducers';

const BACKUP_ERROR_KEYS = {
  unavailable: 'BackupsUnavailable',
  rateLimited: 'BackupsErrorRateLimited',
  network: 'BackupsErrorNetwork',
  notEnabledOnPrimary: 'BackupsErrorNotEnabled',
  invalidBackup: 'BackupsErrorInvalidBackup',
  wrongKey: 'BackupsErrorWrongKey',
  invalidKey: 'BackupsErrorInvalidKey',
  forwardSecrecyLost: 'BackupsErrorForwardSecrecy',
  rejected: 'BackupsErrorRejected',
  existingBackup: 'BackupsErrorExistingBackup',
  failed: 'ErrorUnexpected',
} satisfies Record<string, RegularLangKey>;
const REVOKE_URL_DELAY_MS = 60 * 1000;

addActionHandler('loadBackupSettings', async (global): Promise<void> => {
  const backups = await callApi('fetchBackupSettings');
  global = getGlobal();
  global = replaceSettings(global, { backups });
  setGlobal(global);
});

addActionHandler('loadBackupRemoteStatus', async (global): Promise<void> => {
  const backupRemote = await callApi('fetchBackupRemoteStatus');
  global = getGlobal();
  global = replaceSettings(global, { backupRemote });
  setGlobal(global);
});

addActionHandler('enableBackups', async (global, actions, payload): Promise<void> => {
  const { frequency, shouldReplaceBackup, tabId = getCurrentTabId() } = payload;
  await applyBackupResult(await callApi('enableBackups', frequency, shouldReplaceBackup), tabId);
});

addActionHandler('disableBackups', async (global, actions, payload): Promise<void> => {
  const { shouldDeleteBackup, tabId = getCurrentTabId() } = payload;
  await applyBackupResult(await callApi('disableBackups', shouldDeleteBackup), tabId);
});

addActionHandler('setBackupFrequency', async (global, actions, payload): Promise<void> => {
  const { frequency, tabId = getCurrentTabId() } = payload;
  await applyBackupResult(await callApi('setBackupFrequency', frequency), tabId);
});

addActionHandler('backUpNow', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  await applyBackupResult(await callApi('backUpNow'), tabId);
});

addActionHandler('cancelBackup', (): void => {
  void callApi('cancelBackup');
});

addActionHandler('exportBackupFile', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  const result = await callApi('exportBackupFile');
  if (!result) return;
  if (result.error) {
    actions.showNotification({ message: { key: BACKUP_ERROR_KEYS[result.error] }, tabId });
    return;
  }

  const url = URL.createObjectURL(new Blob([result.data], { type: 'application/octet-stream' }));
  if (IS_TAURI) {
    // The desktop app writes the file with its save flow (`tauri/src/files.rs`), which can wait for a save dialog for
    // as long as the user takes, so the URL stays until the save ends
    void saveFile(url, result.fileName).finally(() => URL.revokeObjectURL(url));
    return;
  }

  download(url, result.fileName);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_DELAY_MS);
});

addActionHandler('importBackupFile', async (global, actions, payload): Promise<void> => {
  const { file, recoveryKey, tabId = getCurrentTabId() } = payload;
  const result = await callApi('importBackupFile', new Uint8Array(await file.arrayBuffer()), recoveryKey);
  if (!result) return;
  if (result.error) {
    actions.showNotification({ message: { key: BACKUP_ERROR_KEYS[result.error] }, tabId });
    return;
  }

  actions.showNotification({
    message: {
      key: 'BackupsImportDone',
      variables: { count: result.messageCount },
      options: { pluralValue: result.messageCount },
    },
    tabId,
  });
});

/** Shows the reason that a settings action failed, or keeps the settings it resolved with */
async function applyBackupResult(
  result: ApiBackupSettings | { error: keyof typeof BACKUP_ERROR_KEYS } | undefined, tabId: number,
) {
  if (result && 'error' in result) {
    getActions().showNotification({ message: { key: BACKUP_ERROR_KEYS[result.error] }, tabId });
    await getPromiseActions().loadBackupSettings();
  } else if (result) {
    let global = getGlobal();
    global = replaceSettings(global, { backups: result });
    setGlobal(global);
  }
  void getActions().loadBackupRemoteStatus();
}
