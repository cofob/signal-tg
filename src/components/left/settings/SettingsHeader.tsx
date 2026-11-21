import { memo, useCallback, useMemo } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { Signal } from '../../../util/signals';
import { SettingsScreens } from '../../../types';

import useAppLayout from '../../../hooks/useAppLayout';
import useLang from '../../../hooks/useLang';
import useMultiClick from '../../../hooks/useMultiClick';

import Button from '../../ui/Button';
import DropdownMenu from '../../ui/DropdownMenu';
import MenuItem from '../../ui/MenuItem';
import SettingsSearchInput from './search/SettingsSearchInput';

type OwnProps = {
  currentScreen: SettingsScreens;
  editedFolderId?: number;
  hasProfileBackground?: boolean;
  searchSessionId: number;
  getSearchQuery: Signal<string>;
  onReset: () => void;
  onSearchOpen: NoneToVoidFunction;
  onSearchQueryChange: (query: string) => void;
};

const SettingsHeader = ({
  currentScreen,
  editedFolderId,
  hasProfileBackground,
  searchSessionId,
  getSearchQuery,
  onReset,
  onSearchOpen,
  onSearchQueryChange,
}: OwnProps) => {
  const {
    openDeleteChatFolderModal,
    openSettingsScreen,
    openSettingsConfirmation,
  } = getActions();

  const lang = useLang();
  const { isMobile } = useAppLayout();

  const handleMultiClick = useMultiClick(5, () => {
    openSettingsScreen({ screen: SettingsScreens.Experimental });
  });

  const openDeleteFolderConfirmation = useCallback(() => {
    if (!editedFolderId) return;

    openDeleteChatFolderModal({ folderId: editedFolderId });
  }, [editedFolderId, openDeleteChatFolderModal]);

  const SettingsMenuButton = useMemo(() => {
    return ({ onTrigger, isOpen }: { onTrigger: () => void; isOpen?: boolean }) => (
      <Button
        round
        ripple={!isMobile}
        size="smaller"
        color="translucent"
        className={isOpen ? 'active' : ''}
        onClick={onTrigger}
        ariaLabel={lang('AccDescrMoreOptions')}
        iconName="more"
      />
    );
  }, [isMobile, lang]);

  function renderHeaderContent() {
    switch (currentScreen) {
      case SettingsScreens.Search:
        return (
          <SettingsSearchInput
            key={searchSessionId}
            getQuery={getSearchQuery}
            onChange={onSearchQueryChange}
          />
        );
      case SettingsScreens.EditProfile:
        return <h3>{lang('SettingsInformation')}</h3>;
      case SettingsScreens.General:
        return <h3>{lang('General')}</h3>;
      case SettingsScreens.CustomEmoji:
        return <h3>{lang('Emoji')}</h3>;
      case SettingsScreens.Notifications:
        return <h3>{lang('Notifications')}</h3>;
      case SettingsScreens.DataStorage:
        return <h3>{lang('DataSettings')}</h3>;
      case SettingsScreens.SignalProxy:
        return <h3>{lang('SignalProxyTitle')}</h3>;
      case SettingsScreens.SignalSealedSenderProxy:
        return <h3>{lang('SignalSealedProxyTitle')}</h3>;
      case SettingsScreens.Username:
        return <h3>{lang('Username')}</h3>;
      case SettingsScreens.SignalPin:
      case SettingsScreens.SignalPinNew:
      case SettingsScreens.SignalPinConfirm:
        return <h3>{lang('SignalPinSettings')}</h3>;
      case SettingsScreens.Privacy:
        return <h3>{lang('PrivacySettings')}</h3>;
      case SettingsScreens.AutoDeleteMessages:
        return <h3>{lang('AutoDeleteMessages')}</h3>;
      case SettingsScreens.Language:
        return <h3>{lang('Language')}</h3>;
      case SettingsScreens.Stickers:
        return <h3>{lang('Stickers')}</h3>;
      case SettingsScreens.Experimental:
        return <h3>{lang('SettingsExperimental')}</h3>;

      case SettingsScreens.GeneralChatBackground:
        return <h3>{lang('ChatBackground')}</h3>;
      case SettingsScreens.GeneralChatBackgroundColor:
        return <h3>{lang('SetColor')}</h3>;

      case SettingsScreens.PrivacyPhoneNumber:
        return <h3>{lang('PrivacyPhone')}</h3>;
      case SettingsScreens.PrivacyLastSeen:
        return <h3>{lang('PrivacyLastSeen')}</h3>;
      case SettingsScreens.PrivacyProfilePhoto:
        return <h3>{lang('PrivacyProfilePhoto')}</h3>;
      case SettingsScreens.PrivacyBio:
        return <h3>{lang('PrivacyBio')}</h3>;
      case SettingsScreens.PrivacyBirthday:
        return <h3>{lang('PrivacyBirthday')}</h3>;
      case SettingsScreens.PrivacySavedMusic:
        return <h3>{lang('PrivacyMusic')}</h3>;
      case SettingsScreens.PrivacyForwarding:
        return <h3>{lang('PrivacyForwards')}</h3>;
      case SettingsScreens.PrivacyVoiceMessages:
        return <h3>{lang('PrivacyVoiceMessages')}</h3>;
      case SettingsScreens.PrivacyGroupChats:
        return <h3>{lang('AutodownloadGroupChats')}</h3>;
      case SettingsScreens.PrivacyPhoneCall:
        return <h3>{lang('Calls')}</h3>;

      case SettingsScreens.PrivacyLastSeenAllowedContacts:
      case SettingsScreens.PrivacyProfilePhotoAllowedContacts:
      case SettingsScreens.PrivacyBioAllowedContacts:
      case SettingsScreens.PrivacyGroupChatsAllowedContacts:
      case SettingsScreens.PrivacySavedMusicAllowedContacts:
        return <h3>{lang('AlwaysShareWith')}</h3>;

      case SettingsScreens.PrivacyLastSeenDeniedContacts:
      case SettingsScreens.PrivacyProfilePhotoDeniedContacts:
      case SettingsScreens.PrivacyBioDeniedContacts:
      case SettingsScreens.PrivacyGroupChatsDeniedContacts:
      case SettingsScreens.PrivacySavedMusicDeniedContacts:
        return <h3>{lang('NeverShareWith')}</h3>;

      case SettingsScreens.PrivacyPhoneNumberAllowedContacts:
      case SettingsScreens.PrivacyBirthdayAllowedContacts:
      case SettingsScreens.PrivacyForwardingAllowedContacts:
      case SettingsScreens.PrivacyVoiceMessagesAllowedContacts:
      case SettingsScreens.PrivacyPhoneCallAllowedContacts:
      case SettingsScreens.PrivacyPhoneP2PAllowedContacts:
        return <h3>{lang('AlwaysAllow')}</h3>;

      case SettingsScreens.PrivacyPhoneNumberDeniedContacts:
      case SettingsScreens.PrivacyBirthdayDeniedContacts:
      case SettingsScreens.PrivacyForwardingDeniedContacts:
      case SettingsScreens.PrivacyVoiceMessagesDeniedContacts:
      case SettingsScreens.PrivacyPhoneCallDeniedContacts:
      case SettingsScreens.PrivacyPhoneP2PDeniedContacts:
        return <h3>{lang('NeverAllow')}</h3>;

      case SettingsScreens.Performance:
        return <h3>{lang('MenuAnimations')}</h3>;
      case SettingsScreens.SignalDevices:
        return <h3>{lang('SignalDevices')}</h3>;
      case SettingsScreens.Backups:
        return <h3>{lang('SettingsBackups')}</h3>;
      case SettingsScreens.KeyboardShortcuts:
        return <h3>{lang('KeyboardShortcuts')}</h3>;

      case SettingsScreens.PrivacyBlockedUsers:
        return <h3>{lang('BlockedUsers')}</h3>;
      case SettingsScreens.Stories:
        return <h3>{lang('StoriesSettingTitle')}</h3>;
      case SettingsScreens.NotificationProfiles:
        return <h3>{lang('NotificationProfiles')}</h3>;

      case SettingsScreens.PasscodeDisabled:
      case SettingsScreens.PasscodeEnabled:
      case SettingsScreens.PasscodeNewPasscode:
      case SettingsScreens.PasscodeNewPasscodeConfirm:
      case SettingsScreens.PasscodePasskeyAddConfirm:
      case SettingsScreens.PasscodePasskeyRemoveConfirm:
      case SettingsScreens.PasscodeCongratulations:
        return <h3>{lang('Passcode')}</h3>;

      case SettingsScreens.PasscodeTurnOff:
        return <h3>{lang('PasscodeControllerDisableTitle')}</h3>;

      case SettingsScreens.PasscodeChangePasscodeCurrent:
      case SettingsScreens.PasscodeChangePasscodeNew:
        return <h3>{lang('PasscodeControllerChangeTitle')}</h3>;

      case SettingsScreens.PasscodeChangePasscodeConfirm:
        return <h3>{lang('PasscodeControllerReEnterPasscodePlaceholder')}</h3>;

      case SettingsScreens.Folders:
        return <h3>{lang('Filters')}</h3>;
      case SettingsScreens.FoldersCreateFolder:
        return <h3>{lang('FilterNew')}</h3>;
      case SettingsScreens.FoldersEditFolder:
      case SettingsScreens.FoldersEditFolderFromChatList:
        return (
          <div className="settings-main-header">
            <h3>{lang('EditFolder')}</h3>
            {Boolean(editedFolderId) && (
              <DropdownMenu
                className="settings-more-menu"
                trigger={SettingsMenuButton}
                positionX="right"
              >
                <MenuItem icon="delete" destructive onClick={openDeleteFolderConfirmation}>
                  {lang('Delete')}
                </MenuItem>
              </DropdownMenu>
            )}
          </div>
        );
      case SettingsScreens.FoldersIncludedChats:
      case SettingsScreens.FoldersIncludedChatsFromChatList:
      case SettingsScreens.FoldersExcludedChats:
      case SettingsScreens.FoldersExcludedChatsFromChatList:
        return (
          <h3>
            {lang(currentScreen === SettingsScreens.FoldersIncludedChats
              || currentScreen === SettingsScreens.FoldersIncludedChatsFromChatList
              ? 'FilterInclude' : 'FilterExclude')}
          </h3>
        );

      default:
        return (
          <div className="settings-main-header">
            <h3 onClick={handleMultiClick}>
              {lang('Settings')}
            </h3>

            <Button
              round
              ripple={!isMobile}
              size="smaller"
              color="translucent"
              onClick={onSearchOpen}
              ariaLabel={lang('Search')}
              iconName="search"
            />
            <Button
              round
              ripple={!isMobile}
              size="smaller"
              color="translucent"
              onClick={() => openSettingsScreen({ screen: SettingsScreens.EditProfile })}
              ariaLabel={lang('SettingsInformation')}
              iconName="edit"
            />
            <DropdownMenu
              className="settings-more-menu"
              trigger={SettingsMenuButton}
              positionX="right"
            >
              <MenuItem icon="logout" onClick={() => openSettingsConfirmation({ confirmation: 'logOut' })}>
                {lang('LogOutTitle')}
              </MenuItem>
            </DropdownMenu>
          </div>
        );
    }
  }

  return (
    <div className={hasProfileBackground && currentScreen === SettingsScreens.Main
      ? 'left-header' : 'left-header secondary'}
    >
      <Button
        round
        size="smaller"
        color="translucent"
        onClick={onReset}
        ariaLabel={lang('AccDescrGoBack')}
        iconName="arrow-left"
      />
      {renderHeaderContent()}
    </div>
  );
};

export default memo(SettingsHeader);
