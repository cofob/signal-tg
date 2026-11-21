import { getActions, getGlobal, getPromiseActions } from '../global';

import type { SettingsAction } from '../types';
import type { RegularLangKey } from '../types/language';
import { SettingsScreens } from '../types';

import { PRIVACY_URL, SUPPORT_URL } from '../config';
import {
  selectIsWallpaperUploading, selectTabState, selectTheme, selectUserFullInfo,
} from '../global/selectors';
import { purgeClearableCache } from './cacheApi';
import { getCurrentTabId } from './establishMultitabRole';
import { validateFiles } from './files';
import { openSystemFilesDialog } from './systemFilesDialog';
import { buildDefaultWallpaperSettings } from './wallpaper';

const WALLPAPER_FILE_TYPES = 'image/jpeg';

const SETTINGS_ACTIONS: [SettingsScreens, RegularLangKey, SettingsAction][] = [
  [SettingsScreens.Main, 'MenuSignalSupport', 'openSupport'],
  [SettingsScreens.Main, 'MenuPrivacyPolicy', 'openPrivacyPolicy'],
  [SettingsScreens.Main, 'LogOutTitle', 'logOut'],
  [SettingsScreens.EditProfile, 'SettingsBirthday', 'setBirthday'],
  [SettingsScreens.GeneralChatBackground, 'UploadImage', 'uploadWallpaper'],
  [SettingsScreens.GeneralChatBackground, 'ThemeResetToDefaults', 'resetWallpaper'],
  [SettingsScreens.DataStorage, 'SettingsDataClearMediaCache', 'clearMediaCache'],
  [SettingsScreens.Privacy, 'DeleteAccountIfAwayFor', 'setAccountTtl'],
];

export function getSettingsAction(screen: SettingsScreens, langKey: RegularLangKey) {
  return SETTINGS_ACTIONS.find(([actionScreen, actionLangKey]) => (
    actionScreen === screen && actionLangKey === langKey
  ))?.[2];
}

export function runSettingsAction(action: SettingsAction, tabId = getCurrentTabId()) {
  const actions = getActions();

  switch (action) {
    case 'openSupport':
      actions.openUrl({ url: SUPPORT_URL, tabId });
      break;
    case 'openPrivacyPolicy':
      actions.openUrl({ url: PRIVACY_URL, tabId });
      break;
    case 'uploadWallpaper':
      openWallpaperUpload(tabId);
      break;
    case 'resetWallpaper':
      resetWallpaper();
      break;
    case 'clearMediaCache':
      clearMediaCache(tabId);
      break;
    case 'setBirthday':
      openBirthdaySetup(tabId);
      break;
    case 'setAccountTtl':
      void runAfterLoading(tabId, () => getPromiseActions().loadAccountDaysTtl(), () => openAccountTtlSetup(tabId));
      break;
    default:
      actions.openSettingsConfirmation({ confirmation: action, tabId });
  }
}

function openWallpaperUpload(tabId: number) {
  getActions().openSettingsScreen({ screen: SettingsScreens.GeneralChatBackground, tabId });
  if (selectIsWallpaperUploading(getGlobal())) return;

  openWallpaperFileDialog();
}

export function openWallpaperFileDialog() {
  openSystemFilesDialog(WALLPAPER_FILE_TYPES, (e) => {
    const validatedFiles = validateFiles((e.target as HTMLInputElement).files);
    if (validatedFiles?.length) getActions().uploadWallpaper(validatedFiles[0]);
  }, true);
}

export function resetWallpaper() {
  const theme = selectTheme(getGlobal());
  getActions().setThemeSettings({ theme, ...buildDefaultWallpaperSettings(theme) });
}

export function clearMediaCache(tabId?: number) {
  purgeClearableCache();
  getActions().showNotification({
    message: { key: 'SettingsDataClearMediaDone' },
    tabId,
  });
}

async function runAfterLoading(tabId: number, load: () => Promise<void>, callback: NoneToVoidFunction) {
  const { contentKey, settingsScreen } = selectTabState(getGlobal(), tabId).leftColumn;
  await load();

  const { leftColumn } = selectTabState(getGlobal(), tabId);
  if (leftColumn.contentKey !== contentKey || leftColumn.settingsScreen !== settingsScreen) return;

  callback();
}

function openBirthdaySetup(tabId: number) {
  const global = getGlobal();
  const currentBirthday = global.currentUserId ? selectUserFullInfo(global, global.currentUserId)?.birthday : undefined;
  getActions().openBirthdaySetupModal({ currentBirthday, tabId });
}

function openAccountTtlSetup(tabId: number) {
  const { accountDaysTtl } = getGlobal().settings;
  if (accountDaysTtl) getActions().openDeleteAccountModal({ days: accountDaysTtl, tabId });
}
