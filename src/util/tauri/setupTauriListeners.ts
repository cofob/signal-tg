import { getActions } from '../../global';

import { SettingsScreens } from '../../types';

import { DEBUG } from '../../config';
import { MouseButton } from '../browser/windowEnvironment';
import { isDeepLink } from '../deepLinkParser';
import { isSgnlLink, parseSignalLink } from '../signalLinks';

const NOTIFICATION_CLICKED_EVENT = 'notification-clicked';
const OPEN_SETTINGS_EVENT = 'open-settings';

type NotificationClick = {
  chatId: string;
  messageId?: number;
};

let isSetup = false;
export default function setupTauriListeners() {
  if (isSetup) return;
  isSetup = true;

  // Show the system context menu only in text fields (cut, copy, paste, spelling suggestions) in production builds,
  // which have no inspector; elsewhere it holds browser items such as Reload and Back
  if (!DEBUG) {
    document.addEventListener('contextmenu', (event) => {
      if (!getIsEditableTarget(event.target)) event.preventDefault();
    });
  }

  void listenToNativeEvents();

  // Disable Backspace handling as back navigation
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Backspace' || event.code === 'Backspace') {
      const target = event.target as HTMLElement | null;
      const isInputField = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;

      if (!isInputField) {
        event.preventDefault();
      }
    }
  }, true);

  // A window that the page asks for is meant for the browser, even when the address is one of Signal's links
  window.open = (url: string | URL | undefined, target?: string, features?: string) => {
    if (url) openLink(url, true);
    // eslint-disable-next-line no-null/no-null
    return null;
  };

  function handleClick(event: MouseEvent) {
    if (event.defaultPrevented) return;

    const target = event.target as HTMLElement | null;
    const anchor = target?.closest<HTMLAnchorElement>('a[href]');

    if (!anchor) return;

    const isModifiedClick = event.ctrlKey || event.metaKey || event.button === MouseButton.Auxiliary;
    if (anchor.target === '_blank' || isModifiedClick) {
      event.preventDefault();

      const href = anchor.getAttribute('href')!;
      // A click with a modifier asks for the browser, so a Signal link on the web stays there
      openLink(href, isModifiedClick);
    }
  }

  // Run after Teact's delegated handlers so links can require confirmation
  window.addEventListener('click', handleClick);
  window.addEventListener('auxclick', handleClick);
}

function getIsEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement);
}

async function listenToNativeEvents() {
  try {
    const { listen } = await import('@tauri-apps/api/event');

    // The app brought the window forward after a click on a notification (`tauri/src/notifications.rs`)
    await listen<NotificationClick>(NOTIFICATION_CLICKED_EVENT, ({ payload: { chatId, messageId } }) => {
      if (messageId === undefined) {
        getActions().openChat({ id: chatId, shouldReplaceHistory: true });
        return;
      }
      getActions().focusMessage({ chatId, messageId, shouldReplaceHistory: true });
    });

    // Cmd+, in the macOS menu bar
    await listen(OPEN_SETTINGS_EVENT, () => {
      getActions().openSettingsScreen({ screen: SettingsScreens.Main });
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to listen to native events:', err);
  }
}

async function openLink(url: string | URL, shouldOpenInBrowser?: boolean) {
  // Links that only the app handles stay in it: a `tg:` link would leave for another app, and an `sgnl:` link is
  // the app's own scheme. The addresses of Signal's websites that are routes open in the app too, unless the browser
  // is asked for.
  const href = url.toString();
  if (isDeepLink(href) || isSgnlLink(href) || (!shouldOpenInBrowser && parseSignalLink(href))) {
    getActions().openTelegramLink({ url: href });
    return;
  }

  try {
    const urlObject = url instanceof URL ? url : new URL(url, window.location.href);
    // Only the app itself gets a native window with IPC; other pages on the origin open in the browser
    if (window.location.origin === urlObject.origin && window.location.pathname === urlObject.pathname) {
      await window.tauri.openNewWindow(urlObject.toString());
    } else {
      const shellPlugin = await import('@tauri-apps/plugin-shell');
      await shellPlugin.open(urlObject.toString());
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to open link:', url, e);
  }
}
