import { memo, useState } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { DesktopSettings } from '../../../util/tauri/desktopApp';

import { CAN_PROTECT_CONTENT, fetchDesktopSettings, updateDesktopSettings } from '../../../util/tauri/desktopApp';

import useEffectOnce from '../../../hooks/useEffectOnce';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandTitle } from '../../gili/layout/Island';
import Checkbox from '../../ui/Checkbox';

// The settings of the desktop app, which it stores itself and applies before the page loads (`tauri/src/settings.rs`)
const SettingsDesktopApp = () => {
  const { showNotification } = getActions();

  const lang = useLang();
  const [settings, setSettings] = useState<DesktopSettings>();

  useEffectOnce(() => {
    fetchDesktopSettings().then(setSettings).catch(logError);
  });

  const handleChange = useLastCallback(async (patch: Partial<DesktopSettings>) => {
    setSettings((current) => current && { ...current, ...patch });
    try {
      setSettings(await updateDesktopSettings(patch));
    } catch (err) {
      logError(err);
      showNotification({ message: { key: 'SomethingWentWrong' } });
      fetchDesktopSettings().then(setSettings).catch(logError);
    }
  });

  const handleCloseToTrayChange = useLastCallback((shouldCloseToTray: boolean) => {
    void handleChange({ shouldCloseToTray });
  });

  const handleLaunchAtLoginChange = useLastCallback((shouldLaunchAtLogin: boolean) => {
    void handleChange({ shouldLaunchAtLogin });
  });

  const handleContentProtectionChange = useLastCallback((isContentProtected: boolean) => {
    void handleChange({ isContentProtected });
  });

  if (!settings) return undefined;

  return (
    <>
      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('SettingsDesktopApp')}</IslandTitle>
      <Island>
        <Checkbox
          label={lang('SettingsDesktopTray')}
          subLabel={lang('SettingsDesktopTrayDescription')}
          checked={settings.shouldCloseToTray}
          onCheck={handleCloseToTrayChange}
        />
        <Checkbox
          label={lang('SettingsDesktopAutostart')}
          subLabel={lang('SettingsDesktopAutostartDescription')}
          checked={settings.shouldLaunchAtLogin}
          onCheck={handleLaunchAtLoginChange}
        />
        {CAN_PROTECT_CONTENT && (
          <Checkbox
            label={lang('SettingsDesktopProtect')}
            subLabel={lang('SettingsDesktopProtectDescription')}
            checked={settings.isContentProtected}
            onCheck={handleContentProtectionChange}
          />
        )}
      </Island>
    </>
  );
};

function logError(err: unknown) {
  // eslint-disable-next-line no-console
  console.error('Desktop settings failed:', err);
}

export default memo(SettingsDesktopApp);
