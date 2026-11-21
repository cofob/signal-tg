import { memo, useCallback, useMemo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiPhoto, ApiPrivacySettings } from '../../../api/types';
import { SettingsScreens } from '../../../types';

import { selectUserFullInfo } from '../../../global/selectors';
import { getPrivacyKey } from './helpers/privacy';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandDescription, IslandTitle } from '../../gili/layout/Island';
import ListItem from '../../ui/ListItem';
import RadioGroup from '../../ui/RadioGroup';
import SettingsPrivacyLastSeen from './SettingsPrivacyLastSeen';
import SettingsPrivacyPublicProfilePhoto from './SettingsPrivacyPublicProfilePhoto';

type OwnProps = {
  screen: SettingsScreens;
  isActive?: boolean;
  onReset: () => void;
};

type StateProps = {
  currentUserId: string;
  hasCurrentUserFullInfo?: boolean;
  currentUserFallbackPhoto?: ApiPhoto;
  primaryPrivacy?: ApiPrivacySettings;
  secondaryPrivacy?: ApiPrivacySettings;
};

const SettingsPrivacyVisibility = ({
  screen,
  isActive,
  primaryPrivacy,
  secondaryPrivacy,
  currentUserId,
  hasCurrentUserFullInfo,
  currentUserFallbackPhoto,
  onReset,
}: OwnProps & StateProps) => {
  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  const secondaryScreen = useMemo(() => {
    switch (screen) {
      case SettingsScreens.PrivacyPhoneCall:
        return SettingsScreens.PrivacyPhoneP2P;
      case SettingsScreens.PrivacyPhoneNumber: {
        return primaryPrivacy?.visibility === 'nobody' ? SettingsScreens.PrivacyAddByPhone : undefined;
      }
      default:
        return undefined;
    }
  }, [primaryPrivacy, screen]);

  return (
    <div className="settings-content custom-scroll">
      <PrivacySubsection
        screen={screen}
        privacy={primaryPrivacy}
      />
      {screen === SettingsScreens.PrivacyProfilePhoto && primaryPrivacy?.visibility !== 'everybody' && (
        <SettingsPrivacyPublicProfilePhoto
          currentUserId={currentUserId}
          hasCurrentUserFullInfo={hasCurrentUserFullInfo}
          currentUserFallbackPhoto={currentUserFallbackPhoto}
        />
      )}
      {screen === SettingsScreens.PrivacyLastSeen && (
        <SettingsPrivacyLastSeen visibility={primaryPrivacy?.visibility} />
      )}
      {Boolean(secondaryScreen) && (
        <PrivacySubsection
          screen={secondaryScreen}
          privacy={secondaryPrivacy}
        />
      )}
    </div>
  );
};

function PrivacySubsection({
  screen,
  privacy,
}: {
  screen: SettingsScreens;
  privacy?: ApiPrivacySettings;
}) {
  const { setPrivacyVisibility, openSettingsScreen } = getActions();

  const lang = useLang();

  const visibilityOptions = useMemo(() => {
    const hasNobody = screen !== SettingsScreens.PrivacyAddByPhone;
    const options = [
      { value: 'everybody', label: lang('P2PEverybody') },
      {
        value: 'contacts',
        label: lang('P2PContacts'),
      },
    ];

    if (hasNobody) {
      options.push({
        value: 'nobody',
        label: lang('P2PNobody'),
      });
    }
    return options;
  }, [lang, screen]);

  const primaryExceptionLists = useMemo(() => {
    if (screen === SettingsScreens.PrivacyAddByPhone) {
      return {
        shouldShowDenied: false,
        shouldShowAllowed: false,
      };
    }

    return {
      shouldShowDenied: privacy?.visibility !== 'nobody',
      shouldShowAllowed: privacy?.visibility !== 'everybody',
    };
  }, [privacy, screen]);

  const privacyKey = getPrivacyKey(screen);

  const descriptionText = useMemo(() => {
    switch (screen) {
      case SettingsScreens.PrivacySavedMusic:
        return lang('PrivacyMusicInfo');
      case SettingsScreens.PrivacyLastSeen:
        return lang('CustomHelp');
      case SettingsScreens.PrivacyAddByPhone: {
        return privacy?.visibility === 'everybody' ? lang('PrivacyPhoneInfo') : lang('PrivacyPhoneInfo3');
      }
      case SettingsScreens.PrivacyVoiceMessages:
        return lang('PrivacyVoiceMessagesInfo');
      default:
        return undefined;
    }
  }, [lang, screen, privacy]);

  const headerText = useMemo(() => {
    switch (screen) {
      case SettingsScreens.PrivacyPhoneNumber:
        return lang('PrivacyPhoneTitle');
      case SettingsScreens.PrivacyAddByPhone:
        return lang('PrivacyPhoneTitle2');
      case SettingsScreens.PrivacyLastSeen:
        return lang('LastSeenTitle');
      case SettingsScreens.PrivacyProfilePhoto:
        return lang('PrivacyProfilePhotoTitle');
      case SettingsScreens.PrivacyBio:
        return lang('PrivacyBioTitle');
      case SettingsScreens.PrivacyBirthday:
        return lang('PrivacyBirthdayTitle');
      case SettingsScreens.PrivacySavedMusic:
        return lang('PrivacyMusicTitle');
      case SettingsScreens.PrivacyForwarding:
        return lang('PrivacyForwardsTitle');
      case SettingsScreens.PrivacyVoiceMessages:
        return lang('PrivacyVoiceMessagesTitle');
      case SettingsScreens.PrivacyGroupChats:
        return lang('WhoCanAddMe');
      case SettingsScreens.PrivacyPhoneCall:
        return lang('WhoCanCallMe');
      case SettingsScreens.PrivacyPhoneP2P:
        return lang('PrivacyP2P');
      default:
        return undefined;
    }
  }, [lang, screen]);

  const prepareSubtitle = useLastCallback(
    (userIds?: string[], chatIds?: string[]) => {
      const userIdsCount = userIds?.length || 0;
      const chatIdsCount = chatIds?.length || 0;
      const hasPeers = userIdsCount || chatIdsCount;

      if (!hasPeers) {
        return lang('EditAdminAddUsers');
      }

      const userCountString = userIdsCount > 0
        ? lang('Users', { count: userIdsCount }, { pluralValue: userIdsCount }) : undefined;
      const chatCountString = chatIdsCount > 0
        ? lang('ChatsPlural', { count: chatIdsCount }, { pluralValue: chatIdsCount }) : undefined;

      return lang.conjunction([userCountString, chatCountString].filter(Boolean));
    },
  );

  const allowedString = useMemo(() => {
    return prepareSubtitle(
      privacy?.allowUserIds,
      privacy?.allowChatIds,
    );
  }, [privacy]);

  const blockString = useMemo(() => {
    return prepareSubtitle(privacy?.blockUserIds, privacy?.blockChatIds);
  }, [privacy]);

  const handleVisibilityChange = useCallback((value) => {
    setPrivacyVisibility({
      privacyKey: privacyKey!,
      visibility: value,
    });
  }, [privacyKey]);

  const allowedContactsScreen = (() => {
    switch (screen) {
      case SettingsScreens.PrivacyPhoneNumber:
        return SettingsScreens.PrivacyPhoneNumberAllowedContacts;
      case SettingsScreens.PrivacyLastSeen:
        return SettingsScreens.PrivacyLastSeenAllowedContacts;
      case SettingsScreens.PrivacyProfilePhoto:
        return SettingsScreens.PrivacyProfilePhotoAllowedContacts;
      case SettingsScreens.PrivacyBio:
        return SettingsScreens.PrivacyBioAllowedContacts;
      case SettingsScreens.PrivacyBirthday:
        return SettingsScreens.PrivacyBirthdayAllowedContacts;
      case SettingsScreens.PrivacySavedMusic:
        return SettingsScreens.PrivacySavedMusicAllowedContacts;
      case SettingsScreens.PrivacyForwarding:
        return SettingsScreens.PrivacyForwardingAllowedContacts;
      case SettingsScreens.PrivacyPhoneCall:
        return SettingsScreens.PrivacyPhoneCallAllowedContacts;
      case SettingsScreens.PrivacyPhoneP2P:
        return SettingsScreens.PrivacyPhoneP2PAllowedContacts;
      case SettingsScreens.PrivacyVoiceMessages:
        return SettingsScreens.PrivacyVoiceMessagesAllowedContacts;
      default:
        return SettingsScreens.PrivacyGroupChatsAllowedContacts;
    }
  })();

  const deniedContactsScreen = (() => {
    switch (screen) {
      case SettingsScreens.PrivacyPhoneNumber:
        return SettingsScreens.PrivacyPhoneNumberDeniedContacts;
      case SettingsScreens.PrivacyLastSeen:
        return SettingsScreens.PrivacyLastSeenDeniedContacts;
      case SettingsScreens.PrivacyProfilePhoto:
        return SettingsScreens.PrivacyProfilePhotoDeniedContacts;
      case SettingsScreens.PrivacyBio:
        return SettingsScreens.PrivacyBioDeniedContacts;
      case SettingsScreens.PrivacyBirthday:
        return SettingsScreens.PrivacyBirthdayDeniedContacts;
      case SettingsScreens.PrivacySavedMusic:
        return SettingsScreens.PrivacySavedMusicDeniedContacts;
      case SettingsScreens.PrivacyForwarding:
        return SettingsScreens.PrivacyForwardingDeniedContacts;
      case SettingsScreens.PrivacyPhoneCall:
        return SettingsScreens.PrivacyPhoneCallDeniedContacts;
      case SettingsScreens.PrivacyPhoneP2P:
        return SettingsScreens.PrivacyPhoneP2PDeniedContacts;
      case SettingsScreens.PrivacyVoiceMessages:
        return SettingsScreens.PrivacyVoiceMessagesDeniedContacts;
      default:
        return SettingsScreens.PrivacyGroupChatsDeniedContacts;
    }
  })();

  return (
    <>
      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{headerText}</IslandTitle>
      <Island>
        <RadioGroup
          name={`visibility-${privacyKey}`}
          options={visibilityOptions}
          onChange={handleVisibilityChange}
          selected={privacy?.visibility}
        />
      </Island>
      {descriptionText && (
        <IslandDescription dir={lang.isRtl ? 'rtl' : undefined}>{descriptionText}</IslandDescription>
      )}
      {(primaryExceptionLists.shouldShowAllowed || primaryExceptionLists.shouldShowDenied) && (
        <>
          <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>
            {lang('PrivacyExceptions')}
          </IslandTitle>
          <Island>
            {primaryExceptionLists.shouldShowAllowed && (
              <ListItem
                narrow
                icon="add-user"
                onClick={() => {
                  openSettingsScreen({ screen: allowedContactsScreen });
                }}
              >
                <div className="multiline-item full-size">
                  <span className="title">{lang('AlwaysAllow')}</span>
                  <span className="subtitle">{allowedString}</span>
                </div>
              </ListItem>
            )}
            {primaryExceptionLists.shouldShowDenied && (
              <ListItem
                narrow
                icon="delete-user"
                onClick={() => {
                  openSettingsScreen({ screen: deniedContactsScreen });
                }}
              >
                <div className="multiline-item full-size">
                  <span className="title">{lang('NeverAllow')}</span>
                  <span className="subtitle">{blockString}</span>
                </div>
              </ListItem>
            )}
          </Island>
        </>
      )}
    </>
  );
}

export default memo(withGlobal<OwnProps>(
  (global, { screen }): Complete<StateProps> => {
    let primaryPrivacy: ApiPrivacySettings | undefined;
    let secondaryPrivacy: ApiPrivacySettings | undefined;

    const {
      currentUserId,
      settings: {
        privacy,
      },
    } = global;

    const currentUserFullInfo = selectUserFullInfo(global, currentUserId!);

    switch (screen) {
      case SettingsScreens.PrivacyPhoneNumber:
        primaryPrivacy = privacy.phoneNumber;
        secondaryPrivacy = privacy.addByPhone;
        break;

      case SettingsScreens.PrivacyLastSeen:
        primaryPrivacy = privacy.lastSeen;
        break;

      case SettingsScreens.PrivacyProfilePhoto:
        primaryPrivacy = privacy.profilePhoto;
        break;

      case SettingsScreens.PrivacyBio:
        primaryPrivacy = privacy.bio;
        break;

      case SettingsScreens.PrivacyBirthday:
        primaryPrivacy = privacy.birthday;
        break;

      case SettingsScreens.PrivacySavedMusic:
        primaryPrivacy = privacy.savedMusic;
        break;

      case SettingsScreens.PrivacyPhoneP2P:
      case SettingsScreens.PrivacyPhoneCall:
        primaryPrivacy = privacy.phoneCall;
        secondaryPrivacy = privacy.phoneP2P;
        break;

      case SettingsScreens.PrivacyForwarding:
        primaryPrivacy = privacy.forwards;
        break;

      case SettingsScreens.PrivacyVoiceMessages:
        primaryPrivacy = privacy.voiceMessages;
        break;

      case SettingsScreens.PrivacyGroupChats:
        primaryPrivacy = privacy.chatInvite;
        break;
    }

    if (!primaryPrivacy) {
      return {
        currentUserId: currentUserId!,
        hasCurrentUserFullInfo: Boolean(currentUserFullInfo),
        currentUserFallbackPhoto: currentUserFullInfo?.fallbackPhoto,
      } as Complete<StateProps>;
    }

    return {
      primaryPrivacy,
      secondaryPrivacy,
      currentUserId: currentUserId!,
      hasCurrentUserFullInfo: Boolean(currentUserFullInfo),
      currentUserFallbackPhoto: currentUserFullInfo?.fallbackPhoto,
    };
  },
)(SettingsPrivacyVisibility));
