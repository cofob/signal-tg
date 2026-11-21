import { memo, useEffect } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import { SettingsScreens } from '../../../types';

import {
  IS_SIGNAL_BACKUPS_ENABLED, PRIVACY_URL, SUPPORT_URL,
} from '../../../config';
import { IS_ANDROID, IS_IOS } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';

import useAppLayout from '../../../hooks/useAppLayout';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';

import ChatExtra from '../../common/profile/ChatExtra';
import ProfileInfo from '../../common/profile/ProfileInfo';
import Island from '../../gili/layout/Island';
import ListItem from '../../ui/ListItem';

import styles from './SettingsMain.module.scss';

type OwnProps = {
  isActive?: boolean;
  onReset: () => void;
};

type StateProps = {
  currentUserId?: string;
};

const SettingsMain = ({
  isActive,
  currentUserId,
  onReset,
}: OwnProps & StateProps) => {
  const {
    loadMoreProfilePhotos,
    openUrl,
    openSettingsScreen,
  } = getActions();

  const lang = useLang();

  const { isMobile } = useAppLayout();
  const isMobileDevice = isMobile && (IS_IOS || IS_ANDROID);

  useEffect(() => {
    if (currentUserId) {
      loadMoreProfilePhotos({ peerId: currentUserId, isPreload: true });
    }
  }, [currentUserId]);

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  return (
    <div className={buildClassName(styles.root, 'settings-main-scroll', 'custom-scroll')}>
      <div className={styles.selfProfile}>
        {currentUserId && (
          <ProfileInfo
            peerId={currentUserId}
            isActive={Boolean(isActive)}
            canPlayVideo={Boolean(isActive)}
            isForSettings
          />
        )}
        {currentUserId && (
          <ChatExtra
            chatOrUserId={currentUserId}
            isInSettings
          />
        )}
      </div>
      <div className={styles.menuSection}>

        <Island>
          <ListItem
            icon="account-filled"
            iconBg="blue"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.EditProfile })}
          >
            <span className="title">{lang('SettingsAccount')}</span>
            <span className="subtitle">{lang('SettingsAccountDesc')}</span>
          </ListItem>

          <ListItem
            icon="settings-filled"
            iconBg="orange"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.General })}
          >
            <span className="title">{lang('SettingsGeneralTitle')}</span>
            <span className="subtitle">{lang('SettingsGeneralDesc')}</span>
          </ListItem>

          <ListItem
            icon="notifications-filled"
            iconBg="red"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.Notifications })}
          >
            <span className="title">{lang('Notifications')}</span>
            <span className="subtitle">{lang('SettingsNotificationsDesc')}</span>
          </ListItem>

          <ListItem
            icon="lock-filled"
            iconBg="gray"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.Privacy })}
          >
            <span className="title">{lang('PrivacySettings')}</span>
            <span className="subtitle">{lang('SettingsPrivacyDesc')}</span>
          </ListItem>

          <ListItem
            icon="piechart-filled"
            iconBg="green"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.DataStorage })}
          >
            <span className="title">{lang('DataSettings')}</span>
            <span className="subtitle">{lang('SettingsDataDesc')}</span>
          </ListItem>

          <ListItem
            icon="folder-filled"
            iconBg="blue"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.Folders })}
          >
            <span className="title">{lang('Filters')}</span>
            <span className="subtitle">{lang('SettingsFoldersDesc')}</span>
          </ListItem>

          {IS_SIGNAL_BACKUPS_ENABLED && (
            <ListItem
              icon="archive-filled"
              iconBg="orange"
              multiline
              narrow
              onClick={() => openSettingsScreen({ screen: SettingsScreens.Backups })}
            >
              <span className="title">{lang('SettingsBackups')}</span>
              <span className="subtitle">{lang('SettingsBackupsDesc')}</span>
            </ListItem>
          )}

          <ListItem
            icon="devices-filled"
            iconBg="blue"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.SignalDevices })}
          >
            <span className="title">{lang('SignalDevices')}</span>
            <span className="subtitle">{lang('SettingsSignalDevicesDesc')}</span>
          </ListItem>

          <ListItem
            icon="animations-filled"
            iconBg="purple"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.Performance })}
          >
            <span className="title">{lang('MenuAnimations')}</span>
            <span className="subtitle">{lang('SettingsPerformanceDesc')}</span>
          </ListItem>

          <ListItem
            icon="smile-filled"
            iconBg="pink"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.Stickers })}
          >
            <span className="title">{lang('MenuStickers')}</span>
            <span className="subtitle">{lang('SettingsStickersDesc')}</span>
          </ListItem>

          <ListItem
            icon="web-filled"
            iconBg="purple"
            multiline
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.Language })}
          >
            <span className="title">{lang('Language')}</span>
            <span className="subtitle">
              {lang('SettingsLanguageDesc', { language: lang.languageInfo?.nativeName || lang.rawCode })}
            </span>
          </ListItem>

          {!isMobileDevice && (
            <ListItem
              icon="keyboard-filled"
              iconBg="gray"
              multiline
              narrow
              onClick={() => openSettingsScreen({ screen: SettingsScreens.KeyboardShortcuts })}
            >
              <span className="title">{lang('KeyboardShortcuts')}</span>
              <span className="subtitle">{lang('KeyboardShortcutsDesc')}</span>
            </ListItem>
          )}
        </Island>

        <Island>
          <ListItem
            icon="help-filled"
            iconBg="blue"
            narrow
            onClick={() => openUrl({ url: SUPPORT_URL })}
          >
            {lang('MenuSignalSupport')}
          </ListItem>
          <ListItem
            icon="privacy-policy-filled"
            iconBg="green"
            narrow
            onClick={() => openUrl({ url: PRIVACY_URL })}
          >
            {lang('MenuPrivacyPolicy')}
          </ListItem>
        </Island>
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const { currentUserId } = global;

    return {
      currentUserId,
    };
  },
)(SettingsMain));
