import {
  memo, useCallback, useEffect, useMemo, useState,
} from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type { ApiPrivacySettings } from '../../../api/types';
import type { GlobalState } from '../../../global/types';
import { SettingsScreens } from '../../../types';

import { ALL_FOLDER_ID, ARCHIVED_FOLDER_ID } from '../../../config';
import {
  isChatChannel, isDeletedUser,
} from '../../../global/helpers';
import { filterPeersByQuery } from '../../../global/helpers/peers';
import { unique } from '../../../util/iteratees';
import { getPrivacyKey } from './helpers/privacy';

import { useFolderManagerForOrderedIds } from '../../../hooks/useFolderManager';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';

import PeerPicker from '../../common/pickers/PeerPicker';
import FloatingActionButton from '../../ui/FloatingActionButton';

export type OwnProps = {
  isAllowList?: boolean;
  usersOnly?: boolean;
  screen: SettingsScreens;
  isActive?: boolean;
  onReset: () => void;
};

type StateProps = {
  currentUserId?: string;
  settings?: ApiPrivacySettings;
};

const SettingsPrivacyVisibilityExceptionList = ({
  isAllowList,
  screen,
  isActive,
  currentUserId,
  settings,
  usersOnly = false,
  onReset,
}: OwnProps & StateProps) => {
  const { setPrivacySettings } = getActions();

  const lang = useLang();

  const selectedContactIds = useMemo(() => {
    if (!settings) {
      return [];
    }

    if (isAllowList) {
      return [...settings.allowUserIds, ...settings.allowChatIds];
    } else {
      return [...settings.blockUserIds, ...settings.blockChatIds];
    }
  }, [isAllowList, settings]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSubmitShown, setIsSubmitShown] = useState<boolean>(false);
  const [newSelectedContactIds, setNewSelectedContactIds] = useState<string[]>(selectedContactIds);

  // Reset selected contact ids on change from other client when screen is not active
  useEffect(() => {
    if (!isActive) {
      setNewSelectedContactIds(selectedContactIds);
    }
  }, [isActive, selectedContactIds]);

  const folderAllOrderedIds = useFolderManagerForOrderedIds(ALL_FOLDER_ID);
  const folderArchivedOrderedIds = useFolderManagerForOrderedIds(ARCHIVED_FOLDER_ID);
  const displayedIds = useMemo(() => {
    // No need for expensive global updates on chats, so we avoid them
    const chatsById = getGlobal().chats.byId;
    const usersById = getGlobal().users.byId;

    const chatIds = unique([...folderAllOrderedIds || [], ...folderArchivedOrderedIds || []])
      .filter((chatId) => {
        const chat = chatsById[chatId];
        const user = usersById[chatId];
        const isDeleted = user && isDeletedUser(user);
        const isChannel = chat && isChatChannel(chat);
        return (!usersOnly || user)
          && chatId !== currentUserId
          && !isChannel && !isDeleted;
      });

    const filteredChats = filterPeersByQuery({ ids: chatIds, query: searchQuery });

    // Show only relevant items
    if (searchQuery) return filteredChats;

    return unique([
      ...selectedContactIds,
      ...chatIds,
    ]);
  }, [folderAllOrderedIds, folderArchivedOrderedIds, selectedContactIds, searchQuery, currentUserId, usersOnly]);

  const handleSelectedContactIdsChange = useCallback((value: string[]) => {
    setNewSelectedContactIds(value);
    setIsSubmitShown(true);
  }, []);

  const handleSubmit = useCallback(() => {
    setPrivacySettings({
      privacyKey: getPrivacyKey(screen)!,
      isAllowList: Boolean(isAllowList),
      updatedIds: newSelectedContactIds,
    });

    onReset();
  }, [
    isAllowList,
    newSelectedContactIds,
    onReset,
    screen,
  ]);

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  return (
    <div className="Picker settings-picker-islands">
      <PeerPicker
        itemIds={displayedIds || []}
        selectedIds={newSelectedContactIds}
        filterValue={searchQuery}
        filterPlaceholder={isAllowList ? lang('AlwaysAllowPlaceholder') : lang('NeverAllowPlaceholder')}
        searchInputId="new-group-picker-search"
        isSearchable
        onSelectedIdsChange={handleSelectedContactIdsChange}
        onFilterChange={setSearchQuery}
        allowMultiple
        itemInputType="checkbox"
        withDefaultPadding
        withStatus
        withIslands
      />

      <FloatingActionButton
        isShown={isSubmitShown}
        onClick={handleSubmit}
        ariaLabel={isAllowList ? lang('AlwaysAllow') : lang('NeverAllow')}
        iconName="check"
      />
    </div>
  );
};

function getCurrentPrivacySettings(global: GlobalState, screen: SettingsScreens) {
  const { privacy } = global.settings;
  switch (screen) {
    case SettingsScreens.PrivacyPhoneNumberAllowedContacts:
    case SettingsScreens.PrivacyPhoneNumberDeniedContacts:
      return privacy.phoneNumber;
    case SettingsScreens.PrivacyLastSeenAllowedContacts:
    case SettingsScreens.PrivacyLastSeenDeniedContacts:
      return privacy.lastSeen;
    case SettingsScreens.PrivacyProfilePhotoAllowedContacts:
    case SettingsScreens.PrivacyProfilePhotoDeniedContacts:
      return privacy.profilePhoto;
    case SettingsScreens.PrivacyBioAllowedContacts:
    case SettingsScreens.PrivacyBioDeniedContacts:
      return privacy.bio;
    case SettingsScreens.PrivacyBirthdayAllowedContacts:
    case SettingsScreens.PrivacyBirthdayDeniedContacts:
      return privacy.birthday;
    case SettingsScreens.PrivacySavedMusicAllowedContacts:
    case SettingsScreens.PrivacySavedMusicDeniedContacts:
      return privacy.savedMusic;
    case SettingsScreens.PrivacyPhoneCallAllowedContacts:
    case SettingsScreens.PrivacyPhoneCallDeniedContacts:
      return privacy.phoneCall;
    case SettingsScreens.PrivacyPhoneP2PAllowedContacts:
    case SettingsScreens.PrivacyPhoneP2PDeniedContacts:
      return privacy.phoneP2P;
    case SettingsScreens.PrivacyForwardingAllowedContacts:
    case SettingsScreens.PrivacyForwardingDeniedContacts:
      return privacy.forwards;
    case SettingsScreens.PrivacyVoiceMessagesAllowedContacts:
    case SettingsScreens.PrivacyVoiceMessagesDeniedContacts:
      return privacy.voiceMessages;
    case SettingsScreens.PrivacyGroupChatsDeniedContacts:
    case SettingsScreens.PrivacyGroupChatsAllowedContacts:
      return privacy.chatInvite;
  }

  return undefined;
}

export default memo(withGlobal<OwnProps>(
  (global, { screen }): Complete<StateProps> => {
    return {
      currentUserId: global.currentUserId,
      settings: getCurrentPrivacySettings(global, screen),
    };
  },
)(SettingsPrivacyVisibilityExceptionList));
