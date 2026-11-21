import { memo, useCallback, useEffect } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiNotifyPeerType, ApiPeerNotifySettings } from '../../../api/types';
import { SettingsScreens } from '../../../types';

import { NOTIFICATION_MAX_VOLUME } from '../../../config';
import { IS_IOS } from '../../../util/browser/windowEnvironment';
import { checkIfNotificationsSupported, playNotifySound } from '../../../util/notifications';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import useRunDebounced from '../../../hooks/useRunDebounced';

import Island, { IslandTitle } from '../../gili/layout/Island';
import Checkbox from '../../ui/Checkbox';
import ListItem from '../../ui/ListItem';
import RangeSlider from '../../ui/RangeSlider';

type OwnProps = {
  isActive?: boolean;
  onReset: () => void;
};

type StateProps = {
  notifyDefaults?: Record<ApiNotifyPeerType, ApiPeerNotifySettings>;
  hasContactJoinedNotifications: boolean;
  shouldNotifyAboutPinnedMessages: boolean;
  hasWebNotifications: boolean;
  hasPasscode?: boolean;
  shouldShowPushPreviewsWhenLocked: boolean;
  notificationSoundVolume: number;
};

const SettingsNotifications = ({
  isActive,
  onReset,
  notifyDefaults,
  hasContactJoinedNotifications,
  shouldNotifyAboutPinnedMessages,
  hasWebNotifications,
  hasPasscode,
  shouldShowPushPreviewsWhenLocked,
  notificationSoundVolume,
}: OwnProps & StateProps) => {
  const {
    loadNotificationSettings,
    openSettingsScreen,
    setSettingOption,
    updateContactSignUpNotification,
    updateNotificationSettings,
    updateWebNotificationSettings,
  } = getActions();
  const lang = useLang();

  useEffect(() => {
    loadNotificationSettings();
  }, [loadNotificationSettings]);

  const runDebounced = useRunDebounced(500, true);

  const areNotificationsSupported = checkIfNotificationsSupported();

  const areGroupsMuted = Boolean(notifyDefaults?.groups?.mutedUntil);
  const areUsersMuted = Boolean(notifyDefaults?.users?.mutedUntil);

  const handleSettingsChange = useCallback((
    e: React.ChangeEvent<HTMLInputElement>,
    peerType: ApiNotifyPeerType,
    setting: 'mute' | 'showPreviews',
  ) => {
    const currentIsMuted = Boolean(notifyDefaults?.[peerType]?.mutedUntil);
    const currentShouldShowPreviews = Boolean(notifyDefaults?.[peerType]?.shouldShowPreviews);

    updateNotificationSettings({
      peerType,
      isMuted: setting === 'mute' ? !e.target.checked : currentIsMuted,
      shouldShowPreviews: setting === 'showPreviews' ? e.target.checked : currentShouldShowPreviews,
    });
  }, [notifyDefaults, updateNotificationSettings]);

  const handleWebNotificationsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateWebNotificationSettings({ hasWebNotifications: e.target.checked });
  }, [updateWebNotificationSettings]);

  const handlePushPreviewsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateWebNotificationSettings({ shouldShowPushPreviewsWhenLocked: e.target.checked });
  }, [updateWebNotificationSettings]);

  const handlePrivateChatsNotificationsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleSettingsChange(e, 'users', 'mute');
  }, [handleSettingsChange]);

  const handlePrivateChatsPreviewChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleSettingsChange(e, 'users', 'showPreviews');
  }, [handleSettingsChange]);

  const handleGroupsNotificationsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleSettingsChange(e, 'groups', 'mute');
  }, [handleSettingsChange]);

  const handleGroupsPreviewChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleSettingsChange(e, 'groups', 'showPreviews');
  }, [handleSettingsChange]);

  const handleContactNotificationChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateContactSignUpNotification({
      isSilent: !e.target.checked,
    });
  }, [updateContactSignUpNotification]);

  const handlePinnedMessagesNotificationChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSettingOption({ shouldNotifyAboutPinnedMessages: e.target.checked });
  }, [setSettingOption]);

  const handleOpenProfiles = useLastCallback(() => {
    openSettingsScreen({ screen: SettingsScreens.NotificationProfiles });
  });

  const handleVolumeChange = useCallback((volume: number) => {
    updateWebNotificationSettings({
      notificationSoundVolume: volume,
    });
    runDebounced(() => playNotifySound(undefined, volume));
  }, [runDebounced, updateWebNotificationSettings]);

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  return (
    <div className="settings-content custom-scroll">
      <Island>
        <ListItem
          icon="mute"
          iconBg="purple"
          narrow
          onClick={handleOpenProfiles}
        >
          {lang('NotificationProfiles')}
        </ListItem>
      </Island>

      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>
        {lang('NotificationsWeb')}
      </IslandTitle>
      <Island>
        <Checkbox
          label={lang('NotificationsWeb')}
          subLabel={lang(hasWebNotifications ? 'UserInfoNotificationsEnabled' : 'UserInfoNotificationsDisabled')}
          checked={hasWebNotifications}
          disabled={!areNotificationsSupported}
          onChange={handleWebNotificationsChange}
        />
        {hasPasscode && (
          <Checkbox
            label={lang('PushPreviewsWhenLocked')}
            subLabel={lang('PushPreviewsWhenLockedInfo')}
            checked={shouldShowPushPreviewsWhenLocked}
            disabled={!hasWebNotifications || !areNotificationsSupported}
            onChange={handlePushPreviewsChange}
          />
        )}
        {!IS_IOS && (
          <RangeSlider
            label={lang('NotificationsSound')}
            min={0}
            max={NOTIFICATION_MAX_VOLUME}
            disabled={!areNotificationsSupported}
            value={notificationSoundVolume}
            onChange={handleVolumeChange}
          />
        )}
      </Island>

      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>
        {lang('AutodownloadPrivateChats')}
      </IslandTitle>
      <Island>
        <Checkbox
          label={lang('NotificationsForPrivateChats')}
          subLabel={lang(!areUsersMuted ? 'UserInfoNotificationsEnabled' : 'UserInfoNotificationsDisabled')}
          checked={!areUsersMuted}
          onChange={handlePrivateChatsNotificationsChange}
        />
        <Checkbox
          label={lang('MessagePreview')}
          disabled={areUsersMuted}
          subLabel={lang(notifyDefaults?.users?.shouldShowPreviews
            ? 'UserInfoNotificationsEnabled' : 'UserInfoNotificationsDisabled')}
          checked={Boolean(notifyDefaults?.users?.shouldShowPreviews)}
          onChange={handlePrivateChatsPreviewChange}
        />
      </Island>

      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('FilterGroups')}</IslandTitle>
      <Island>
        <Checkbox
          label={lang('NotificationsForGroups')}
          subLabel={lang(!areGroupsMuted ? 'UserInfoNotificationsEnabled' : 'UserInfoNotificationsDisabled')}
          checked={!areGroupsMuted}
          onChange={handleGroupsNotificationsChange}
        />
        <Checkbox
          label={lang('MessagePreview')}
          disabled={areGroupsMuted}
          subLabel={lang(notifyDefaults?.groups?.shouldShowPreviews
            ? 'UserInfoNotificationsEnabled' : 'UserInfoNotificationsDisabled')}
          checked={Boolean(notifyDefaults?.groups?.shouldShowPreviews)}
          onChange={handleGroupsPreviewChange}
        />
      </Island>

      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('PhoneOther')}</IslandTitle>
      <Island>
        <Checkbox
          label={lang('ContactJoined')}
          checked={hasContactJoinedNotifications}
          onChange={handleContactNotificationChange}
        />
        <Checkbox
          label={lang('PinnedMessagesNotifications')}
          checked={shouldNotifyAboutPinnedMessages}
          onChange={handlePinnedMessagesNotificationChange}
        />
      </Island>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    return {
      hasContactJoinedNotifications: Boolean(global.settings.byKey.hasContactJoinedNotifications),
      shouldNotifyAboutPinnedMessages: global.settings.byKey.shouldNotifyAboutPinnedMessages,
      hasWebNotifications: global.settings.byKey.hasWebNotifications,
      hasPasscode: global.passcode.hasPasscode,
      shouldShowPushPreviewsWhenLocked: global.settings.byKey.shouldShowPushPreviewsWhenLocked,
      notificationSoundVolume: global.settings.byKey.notificationSoundVolume,
      notifyDefaults: global.settings.notifyDefaults,
    };
  },
)(SettingsNotifications));
