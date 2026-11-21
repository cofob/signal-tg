import type { Window as TauriWindow } from '@tauri-apps/api/window';
import type { Update } from '@tauri-apps/plugin-updater';

type TauriApi = {
  version: string;
  /** Whether the build configures the updater (`deploy/prepareTauriConfig.js`) */
  hasUpdater: boolean;
  markTitleBarOverlay: (isOverlay: boolean, isMobile?: boolean) => Promise<void>;
  setNotificationsCount: (amount: number, isMuted?: boolean) => Promise<void>;
  openNewWindow: (url: string) => Promise<void>;
  relaunch: () => Promise<void>;
  checkUpdate: () => Promise<Update | null>;
  getCurrentWindow: () => Promise<TauriWindow>;
  setWindowTitle: (title: string) => Promise<void>;
  /** The `sgnl:` links that reached the app and that the page has not taken yet, oldest first */
  takeDeepLinks: () => Promise<string[]>;
};

declare global {
  interface Window {
    tauri: TauriApi;
  }
}

export {};
