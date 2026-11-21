import { invoke } from '@tauri-apps/api/core';

import type { LangFn } from '../localization';

import { APP_NAME } from '../../config';
import { IS_MAC_OS, IS_WINDOWS } from '../browser/windowEnvironment';

export type DesktopSettings = {
  shouldCloseToTray: boolean;
  shouldLaunchAtLogin: boolean;
  isContentProtected: boolean;
};

/** Only macOS and Windows can hide a window from screenshots (`tauri/src/settings.rs`) */
export const CAN_PROTECT_CONTENT = IS_MAC_OS || IS_WINDOWS;

/** The desktop app keeps these settings itself, so that it applies them before the page loads */
export function fetchDesktopSettings() {
  return invoke<DesktopSettings>('get_desktop_settings');
}

export function updateDesktopSettings(patch: Partial<DesktopSettings>) {
  return invoke<DesktopSettings>('set_desktop_settings', { patch });
}

export function quitApp() {
  return invoke<void>('quit_app');
}

/**
 * Shows a system notification. With `chatId`, a click brings the window forward and the app emits
 * `notification-clicked` to the page (`setupTauriListeners`).
 */
export function showDesktopNotification(title: string, body: string, chatId?: string, messageId?: number) {
  return invoke<void>('show_notification', {
    title, body, chatId, messageId,
  });
}

/** Sends the labels of the tray menu and, on macOS, the menu bar, which Rust builds (`tauri/src/menu.rs`) */
export function sendMenuTranslations(lang: LangFn) {
  const app = APP_NAME;
  const translations = {
    open: lang('DesktopMenuOpen', { app }),
    quit: lang('DesktopMenuQuit', { app }),
    'quit-app': lang('DesktopMenuQuit', { app }),
    hide: lang('DesktopMenuHide', { app }),
    'open-settings': lang('Settings'),
    'hide-window': lang('Close'),
    edit: lang('Edit'),
    undo: lang('DesktopMenuUndo'),
    redo: lang('DesktopMenuRedo'),
    cut: lang('DesktopMenuCut'),
    copy: lang('Copy'),
    paste: lang('DesktopMenuPaste'),
    'select-all': lang('DesktopMenuSelectAll'),
    window: lang('DesktopMenuWindow'),
    minimize: lang('DesktopMenuMinimize'),
  };
  return invoke<void>('set_menu_translations', { translations });
}
