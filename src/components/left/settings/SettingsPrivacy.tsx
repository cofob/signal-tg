import { memo, useEffect, useMemo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiPrivacySettings, ApiSignalMessageSettings, ApiSignalPinSettings } from '../../../api/types';
import type { GlobalState } from '../../../global/types';
import { SettingsScreens } from '../../../types';

import { ACCOUNT_TTL_OPTIONS } from '../../../config';
import {
  selectCanSetPasscode, selectIsCurrentUserFrozen,
} from '../../../global/selectors';
import { selectSharedSettings } from '../../../global/selectors/sharedState';
import { formatCountdown } from '../../../util/dates/duration';
import { getClosestEntry } from '../../../util/getClosestEntry';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandTitle } from '../../gili/layout/Island';
import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';
import ListItem from '../../ui/ListItem';

type OwnProps = {
  isActive?: boolean;
  onReset: () => void;
};

type StateProps = {
  signalPin?: ApiSignalPinSettings;
  signalMessageSettings?: ApiSignalMessageSettings;
  isContactDiscoveryEnabled?: boolean;
  hasPasscode?: boolean;
  canSetPasscode?: boolean;
  blockedCount: number;
  isSensitiveEnabled?: boolean;
  canChangeSensitive?: boolean;
  canDisplayAutoarchiveSetting: boolean;
  shouldArchiveAndMuteNewNonContact?: boolean;
  canDisplayChatInTitle?: boolean;
  isCurrentUserFrozen?: boolean;
  needAgeVideoVerification?: boolean;
  privacy: GlobalState['settings']['privacy'];
  accountDaysTtl?: number;
  defaultHistoryTtl?: number;
};

const DAYS_PER_MONTH = 30;

const SettingsPrivacy = ({
  isActive,
  signalPin,
  signalMessageSettings,
  isContactDiscoveryEnabled,
  hasPasscode,
  blockedCount,
  isSensitiveEnabled,
  canChangeSensitive,
  canDisplayAutoarchiveSetting,
  shouldArchiveAndMuteNewNonContact,
  canDisplayChatInTitle,
  canSetPasscode,
  needAgeVideoVerification,
  privacy,
  isCurrentUserFrozen,
  accountDaysTtl,
  defaultHistoryTtl,
  onReset,
}: OwnProps & StateProps) => {
  const {
    openDeleteAccountModal,
    loadPrivacySettings,
    loadPhoneNumberPrivacy,
    loadBlockedUsers,
    updateContentSettings,
    loadDefaultHistoryTtl,
    loadGlobalPrivacySettings,
    updateGlobalPrivacySettings,
    setSharedSettingOption,
    openSettingsScreen,
    loadAccountDaysTtl,
    openAgeVerificationModal,
    openRecoveryKeyModal,
    loadSignalPinSettings,
    loadSignalContactDiscovery,
    setSignalContactDiscovery,
    loadSignalMessageSettings,
    updateSignalMessageSettings,
  } = getActions();

  useEffect(() => {
    if (!isCurrentUserFrozen) {
      loadBlockedUsers();
      loadPrivacySettings({});
      loadPhoneNumberPrivacy();
      loadSignalPinSettings();
      loadSignalContactDiscovery();
      loadSignalMessageSettings();
    }
  }, [isCurrentUserFrozen]);

  useEffect(() => {
    if (isActive && !isCurrentUserFrozen) {
      loadDefaultHistoryTtl();
      loadGlobalPrivacySettings();
      loadAccountDaysTtl();
    }
  }, [isActive, isCurrentUserFrozen]);

  const lang = useLang();
  const defaultHistoryTtlText = defaultHistoryTtl === undefined
    ? lang('Loading')
    : defaultHistoryTtl === 0
      ? lang('SettingsItemPrivacyOff')
      : formatCountdown(lang, defaultHistoryTtl);

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  const handleContactDiscoveryChange = useLastCallback((isEnabled: boolean) => {
    setSignalContactDiscovery({ isEnabled });
  });

  const handleReadReceiptsChange = useLastCallback((isEnabled: boolean) => {
    updateSignalMessageSettings({ isReadReceiptsEnabled: isEnabled });
  });

  const handleTypingIndicatorsChange = useLastCallback((isEnabled: boolean) => {
    updateSignalMessageSettings({ isTypingIndicatorsEnabled: isEnabled });
  });

  const handleLinkPreviewsChange = useLastCallback((isEnabled: boolean) => {
    updateSignalMessageSettings({ isLinkPreviewsEnabled: isEnabled });
  });

  const handleSealedSenderIndicatorsChange = useLastCallback((isEnabled: boolean) => {
    updateSignalMessageSettings({ isSealedSenderIndicatorsEnabled: isEnabled });
  });

  const handleArchiveAndMuteChange = useLastCallback((isEnabled: boolean) => {
    updateGlobalPrivacySettings({
      shouldArchiveAndMuteNewNonContact: isEnabled,
    });
  });

  const handleChatInTitleChange = useLastCallback((isChecked: boolean) => {
    setSharedSettingOption({
      canDisplayChatInTitle: isChecked,
    });
  });

  const handleUpdateContentSettings = useLastCallback((isChecked: boolean) => {
    updateContentSettings({ isSensitiveEnabled: isChecked });
  });

  const handleAgeVerification = useLastCallback(() => {
    openAgeVerificationModal();
  });

  const handleOpenDeleteAccountModal = useLastCallback(() => {
    if (!accountDaysTtl) return;
    openDeleteAccountModal({ days: accountDaysTtl });
  });

  const handleOpenRecoveryKey = useLastCallback(() => {
    openRecoveryKeyModal();
  });
  const handleOpenAutoDeleteMessages = useLastCallback(() => {
    if (defaultHistoryTtl === undefined) return;

    openSettingsScreen({ screen: SettingsScreens.AutoDeleteMessages });
  });

  const dayOption = useMemo(() => {
    if (!accountDaysTtl) return undefined;
    return getClosestEntry(ACCOUNT_TTL_OPTIONS, accountDaysTtl / DAYS_PER_MONTH).toString();
  }, [accountDaysTtl]);

  function getVisibilityValue(setting?: ApiPrivacySettings) {
    if (!setting) return lang('Loading');

    const { visibility } = setting;

    const isVisibilityEverybody = visibility === 'everybody';

    const blockCount = setting.blockChatIds.length + setting.blockUserIds.length;
    const allowCount = setting.allowChatIds.length + setting.allowUserIds.length;
    const total = [];
    if (blockCount) total.push(`-${blockCount}`);
    if (allowCount && !isVisibilityEverybody) total.push(`+${allowCount}`);

    const exceptionString = lang.conjunction(total);

    switch (visibility) {
      case 'everybody':
        return `${lang('P2PEverybody')} ${exceptionString}`;

      case 'contacts':
        return `${lang('P2PContacts')} ${exceptionString}`;

      case 'nobody':
        return `${lang('P2PNobody')} ${exceptionString}`;
    }

    return undefined;
  }

  return (
    <div className="settings-content custom-scroll">
      <Island>
        <ListItem
          icon="block-filled"
          iconBg="red"
          narrow
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyBlockedUsers })}
        >
          {lang('BlockedUsers')}
          <span className="settings-item__current-value">{blockedCount || ''}</span>
        </ListItem>
        <ListItem
          icon="play-story"
          iconBg="purple"
          narrow
          onClick={() => openSettingsScreen({ screen: SettingsScreens.Stories })}
        >
          {lang('StoriesSettingTitle')}
        </ListItem>
        {canSetPasscode && (
          <ListItem
            icon="lock-filled"
            iconBg="blue"
            narrow
            onClick={() => openSettingsScreen({
              screen: hasPasscode ? SettingsScreens.PasscodeEnabled : SettingsScreens.PasscodeDisabled,
            })}
          >
            <div className="multiline-item">
              <span className="title">{lang('Passcode')}</span>
              <span className="subtitle" dir="auto">
                {lang(hasPasscode ? 'SettingsItemPrivacyOn' : 'SettingsItemPrivacyOff')}
              </span>
            </div>
          </ListItem>
        )}
        {signalPin && (
          <ListItem
            icon="2fa-filled"
            iconBg="green"
            narrow
            onClick={() => openSettingsScreen({ screen: SettingsScreens.SignalPin })}
          >
            <div className="multiline-item">
              <span className="title">{lang('SignalPinSettings')}</span>
              <span className="subtitle" dir="auto">
                {lang(signalPin.hasPin ? 'SettingsItemPrivacyOn' : 'SettingsItemPrivacyOff')}
              </span>
            </div>
          </ListItem>
        )}
        <ListItem
          icon="key-filled"
          iconBg="orange"
          narrow
          onClick={handleOpenRecoveryKey}
        >
          {lang('RecoveryKey')}
        </ListItem>
        {!isCurrentUserFrozen && (
          <ListItem
            icon="timer-filled"
            iconBg="orange"
            narrow
            disabled={defaultHistoryTtl === undefined}
            onClick={handleOpenAutoDeleteMessages}
          >
            <div className="multiline-item">
              <span className="title">{lang('AutoDeleteMessages')}</span>
              <span className="subtitle" dir="auto">{defaultHistoryTtlText}</span>
            </div>
          </ListItem>
        )}
      </Island>

      {isContactDiscoveryEnabled !== undefined && (
        <Island>
          <Checkbox
            label={lang('SignalContactDiscovery')}
            subLabel={lang('SignalContactDiscoveryAbout')}
            checked={isContactDiscoveryEnabled}
            onCheck={handleContactDiscoveryChange}
          />
        </Island>
      )}

      {signalMessageSettings && (
        <Island>
          <Checkbox
            label={lang('SignalReadReceipts')}
            subLabel={lang('SignalReadReceiptsAbout')}
            checked={signalMessageSettings.isReadReceiptsEnabled}
            onCheck={handleReadReceiptsChange}
          />
          <Checkbox
            label={lang('SignalTypingIndicators')}
            subLabel={lang('SignalTypingIndicatorsAbout')}
            checked={signalMessageSettings.isTypingIndicatorsEnabled}
            onCheck={handleTypingIndicatorsChange}
          />
          <Checkbox
            label={lang('SignalSealedSenderIndicators')}
            subLabel={lang('SignalSealedSenderIndicatorsAbout')}
            checked={signalMessageSettings.isSealedSenderIndicatorsEnabled}
            onCheck={handleSealedSenderIndicatorsChange}
          />
          <Checkbox
            label={lang('SignalLinkPreviews')}
            subLabel={lang('SignalLinkPreviewsAbout')}
            checked={signalMessageSettings.isLinkPreviewsEnabled}
            onCheck={handleLinkPreviewsChange}
          />
        </Island>
      )}

      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('PrivacyTitle')}</IslandTitle>
      <Island>
        <ListItem
          narrow
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyPhoneNumber })}
        >
          <div className="multiline-item">
            <span className="title">{lang('PrivacyPhoneTitle')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.phoneNumber)}
            </span>
          </div>
        </ListItem>
        <ListItem
          narrow
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyLastSeen })}
        >
          <div className="multiline-item">
            <span className="title">{lang('LastSeenTitle')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.lastSeen)}
            </span>
          </div>
        </ListItem>
        <ListItem
          narrow
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyProfilePhoto })}
        >
          <div className="multiline-item">
            <span className="title">{lang('PrivacyProfilePhotoTitle')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.profilePhoto)}
            </span>
          </div>
        </ListItem>
        <ListItem
          narrow
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyBio })}
        >
          <div className="multiline-item">
            <span className="title">{lang('PrivacyBio')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.bio)}
            </span>
          </div>
        </ListItem>
        <ListItem
          narrow
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyBirthday })}
        >
          <div className="multiline-item">
            <span className="title">{lang('PrivacyBirthday')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.birthday)}
            </span>
          </div>
        </ListItem>
        <ListItem
          narrow
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacySavedMusic })}
        >
          <div className="multiline-item">
            <span className="title">{lang('PrivacyMusic')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.savedMusic)}
            </span>
          </div>
        </ListItem>
        <ListItem
          narrow
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyForwarding })}
        >
          <div className="multiline-item">
            <span className="title">{lang('PrivacyForwardsTitle')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.forwards)}
            </span>
          </div>
        </ListItem>
        <ListItem
          narrow
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyPhoneCall })}
        >
          <div className="multiline-item">
            <span className="title">{lang('WhoCanCallMe')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.phoneCall)}
            </span>
          </div>
        </ListItem>
        <ListItem
          narrow
          allowDisabledClick
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyVoiceMessages })}
        >
          <div className="multiline-item">
            <span className="title">{lang('PrivacyVoiceMessagesTitle')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.voiceMessages)}
            </span>
          </div>
        </ListItem>
        <ListItem
          narrow
          className="no-icon"
          onClick={() => openSettingsScreen({ screen: SettingsScreens.PrivacyGroupChats })}
        >
          <div className="multiline-item">
            <span className="title">{lang('WhoCanAddMe')}</span>
            <span className="subtitle" dir="auto">
              {getVisibilityValue(privacy.chatInvite)}
            </span>
          </div>
        </ListItem>
      </Island>

      {canChangeSensitive && (
        <>
          <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>
            {lang('SettingsSensitiveTitle')}
          </IslandTitle>
          <Island>
            <Checkbox
              label={lang('SettingsSensitiveDisableFiltering')}
              subLabel={lang('SettingsSensitiveAbout')}
              checked={Boolean(isSensitiveEnabled)}
              disabled={!canChangeSensitive || (!isSensitiveEnabled && needAgeVideoVerification)}
              onCheck={handleUpdateContentSettings}
            />
            {!isSensitiveEnabled && needAgeVideoVerification && (
              <Button
                color="primary"
                noForcedUpperCase
                className="settings-unlock-button"
                onClick={handleAgeVerification}
              >
                <span className="settings-unlock-button-title">
                  {lang('ButtonAgeVerification')}
                </span>
              </Button>
            )}
          </Island>
        </>
      )}

      {canDisplayAutoarchiveSetting && (
        <>
          <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>
            {lang('NewChatsFromNonContacts')}
          </IslandTitle>
          <Island>
            <Checkbox
              label={lang('ArchiveAndMute')}
              subLabel={lang('ArchiveAndMuteInfo')}
              checked={Boolean(shouldArchiveAndMuteNewNonContact)}
              onCheck={handleArchiveAndMuteChange}
            />
          </Island>
        </>
      )}

      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>
        {lang('SettingsWindowSystem')}
      </IslandTitle>
      <Island>
        <Checkbox
          label={lang('SettingsTitleChatName')}
          checked={Boolean(canDisplayChatInTitle)}
          onCheck={handleChatInTitleChange}
        />
      </Island>

      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>
        {lang('DeleteMyAccount')}
      </IslandTitle>
      <Island>
        <ListItem
          narrow
          onClick={handleOpenDeleteAccountModal}
        >
          {lang('DeleteAccountIfAwayFor')}
          <span className="settings-item__current-value">
            {lang('Months', { count: dayOption }, { pluralValue: 1 })}
          </span>
        </ListItem>
      </Island>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const {
      settings: {
        byKey: {
          signalPin, signalMessageSettings, isSignalContactDiscoveryEnabled, isSensitiveEnabled, canChangeSensitive,
          shouldArchiveAndMuteNewNonContact,
          defaultHistoryTtl,
        },
        privacy,
        accountDaysTtl,
      },
      blocked,
      passcode: {
        hasPasscode,
      },
      appConfig,
    } = global;

    const { canDisplayChatInTitle } = selectSharedSettings(global);
    const isCurrentUserFrozen = selectIsCurrentUserFrozen(global);

    return {
      signalPin,
      signalMessageSettings,
      isContactDiscoveryEnabled: isSignalContactDiscoveryEnabled,
      hasPasscode: Boolean(hasPasscode),
      blockedCount: blocked.totalCount,
      isSensitiveEnabled,
      canDisplayAutoarchiveSetting: Boolean(appConfig.canDisplayAutoarchiveSetting),
      shouldArchiveAndMuteNewNonContact,
      canChangeSensitive,
      needAgeVideoVerification: Boolean(appConfig.needAgeVideoVerification),
      privacy,
      canDisplayChatInTitle,
      canSetPasscode: selectCanSetPasscode(global),
      isCurrentUserFrozen,
      accountDaysTtl,
      defaultHistoryTtl,
    };
  },
)(SettingsPrivacy));
