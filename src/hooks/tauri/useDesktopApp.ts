import { useEffect, useMemo } from '../../lib/teact/teact';

import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { quitApp, sendMenuTranslations } from '../../util/tauri/desktopApp';
import useKeyboardShortcuts from '../useKeyboardShortcuts';
import useLang from '../useLang';
import useLastCallback from '../useLastCallback';

/** Gives the desktop app the page's part of its menus and the quit shortcut of systems without a menu bar */
export default function useDesktopApp() {
  const lang = useLang();

  useEffect(() => {
    if (!IS_TAURI) return;

    sendMenuTranslations(lang).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to send the menu translations:', err);
    });
  }, [lang]);

  const handleQuit = useLastCallback(() => {
    void quitApp();
  });

  useKeyboardShortcuts(useMemo(() => (IS_TAURI ? { quitApp: handleQuit } : undefined), [handleQuit]));
}
