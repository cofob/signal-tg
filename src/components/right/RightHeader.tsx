import {
  useEffect, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiExportedInvite } from '../../api/types';
import type { ThreadId } from '../../types';
import { MAIN_THREAD_ID } from '../../api/types';
import { ManagementScreens, ProfileState, SettingsScreens } from '../../types';

import { ANIMATION_END_DELAY, SAVED_FOLDER_ID } from '../../config';
import {
  getCanAddContact, getCanManageTopic, isChatChannel,
} from '../../global/helpers';
import {
  selectCanManage,
  selectChat,
  selectIsChatWithSelf,
  selectTabState,
  selectTopic,
  selectUser,
} from '../../global/selectors';
import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { IS_MAC_OS } from '../../util/browser/windowEnvironment';
import buildClassName from '../../util/buildClassName';
import { isUserId } from '../../util/entities/ids';

import useAppLayout from '../../hooks/useAppLayout';
import useCurrentOrPrev from '../../hooks/useCurrentOrPrev';
import useFlag from '../../hooks/useFlag';
import { useFolderManagerForChatsCount } from '../../hooks/useFolderManager';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Transition from '../ui/Transition';

import './RightHeader.scss';

type OwnProps = {
  chatId?: string;
  threadId?: ThreadId;
  isColumnOpen?: boolean;
  isProfile?: boolean;
  isManagement?: boolean;
  isPollResults?: boolean;
  isCreatingTopic?: boolean;
  isEditingTopic?: boolean;
  isAddingChatMembers?: boolean;
  headerBackground?: 'regular' | 'secondary';
  profileState?: ProfileState;
  managementScreen?: ManagementScreens;
  onClose: (shouldScrollUp?: boolean) => void;
  onScreenSelect: (screen: ManagementScreens) => void;
};

type StateProps = {
  canAddContact?: boolean;
  canManage?: boolean;
  isChannel?: boolean;
  userId?: string;
  isSelf?: boolean;
  isEditingInvite?: boolean;
  currentInviteInfo?: ApiExportedInvite;
  shouldSkipHistoryAnimations?: boolean;
  isInsideTopic?: boolean;
  canEditTopic?: boolean;
  isSavedMessages?: boolean;
  isOwnProfile?: boolean;
};

const COLUMN_ANIMATION_DURATION = 450 + ANIMATION_END_DELAY;

enum HeaderContent {
  Profile,
  MemberList,
  SharedMedia,
  StoryList,
  Search,
  Management,
  ManageInitial,
  ManageChannelSubscribers,
  ManageChatAdministrators,
  ManageChatPrivacyType,
  ManageDiscussion,
  ManageGroupPermissions,
  ManageGroupRemovedUsers,
  ManageChannelRemovedUsers,
  ManageGroupUserPermissionsCreate,
  ManageGroupUserPermissions,
  ManageGroupRecentActions,
  ManageGroupAdminRights,
  ManageGroupNewAdminRights,
  ManageGroupMembers,
  ManageGroupAddAdmins,
  PollResults,
  AddingMembers,
  ManageInvites,
  ManageEditInvite,
  ManageReactions,
  ManageInviteInfo,
  ManageJoinRequests,
  CreateTopic,
  EditTopic,
  SavedDialogs,
  NewDiscussionGroup,
}

const RightHeader = ({
  chatId,
  threadId,
  isColumnOpen,
  isProfile,
  isManagement,
  isPollResults,
  isCreatingTopic,
  isEditingTopic,
  isAddingChatMembers,
  headerBackground,
  profileState,
  managementScreen,
  canAddContact,
  userId,
  isSelf,
  canManage,
  isChannel,
  isEditingInvite,
  currentInviteInfo,
  shouldSkipHistoryAnimations,
  isInsideTopic,
  canEditTopic,
  isSavedMessages,
  isOwnProfile,
  onClose,
  onScreenSelect,
}: OwnProps & StateProps) => {
  const {
    toggleManagement,
    openAddContactDialog,
    setEditingExportedInvite,
    deleteExportedChatInvite,
    openEditTopicPanel,
    openSettingsScreen,
  } = getActions();

  const [isDeleteDialogOpen, openDeleteDialog, closeDeleteDialog] = useFlag();
  const { isMobile } = useAppLayout();

  const foldersChatCount = useFolderManagerForChatsCount();
  const savedDialogsCount = foldersChatCount[SAVED_FOLDER_ID] ?? 0;

  const handleEditInviteClick = useLastCallback(() => {
    setEditingExportedInvite({ chatId: chatId!, invite: currentInviteInfo! });
    onScreenSelect(ManagementScreens.EditInvite);
  });

  const handleDeleteInviteClick = useLastCallback(() => {
    deleteExportedChatInvite({ chatId: chatId!, link: currentInviteInfo!.link });
    onScreenSelect(ManagementScreens.Invites);
    closeDeleteDialog();
  });

  const handleAddContact = useLastCallback(() => {
    openAddContactDialog({ userId });
  });

  const toggleEditTopic = useLastCallback(() => {
    if (!chatId || !threadId) return;
    openEditTopicPanel({ chatId, topicId: Number(threadId) });
  });

  const handleToggleManagement = useLastCallback(() => {
    toggleManagement();
  });

  const handleEditProfile = useLastCallback(() => {
    openSettingsScreen({ screen: SettingsScreens.EditProfile });
  });

  const handleClose = useLastCallback(() => {
    onClose(!isSavedMessages);
  });

  const [shouldSkipTransition, setShouldSkipTransition] = useState(!isColumnOpen);

  useEffect(() => {
    setTimeout(() => {
      setShouldSkipTransition(!isColumnOpen);
    }, COLUMN_ANIMATION_DURATION);
  }, [isColumnOpen]);

  const lang = useLang();

  const isSecondaryBackground = headerBackground === 'secondary';
  const contentKey = isProfile ? (
    profileState === ProfileState.Profile ? (
      HeaderContent.Profile
    ) : profileState === ProfileState.SharedMedia ? (
      HeaderContent.SharedMedia
    ) : profileState === ProfileState.MemberList ? (
      HeaderContent.MemberList
    ) : profileState === ProfileState.StoryList ? (
      HeaderContent.StoryList
    ) : profileState === ProfileState.SavedDialogs ? (
      HeaderContent.SavedDialogs
    ) : -1 // Never reached
  ) : isPollResults ? (
    HeaderContent.PollResults
  ) : isAddingChatMembers ? (
    HeaderContent.AddingMembers
  ) : isManagement ? (
    managementScreen === ManagementScreens.Initial ? (
      HeaderContent.ManageInitial
    ) : managementScreen === ManagementScreens.ChatPrivacyType ? (
      HeaderContent.ManageChatPrivacyType
    ) : managementScreen === ManagementScreens.Discussion ? (
      HeaderContent.ManageDiscussion
    ) : managementScreen === ManagementScreens.ChannelSubscribers ? (
      HeaderContent.ManageChannelSubscribers
    ) : managementScreen === ManagementScreens.GroupPermissions ? (
      HeaderContent.ManageGroupPermissions
    ) : managementScreen === ManagementScreens.ChatAdministrators ? (
      HeaderContent.ManageChatAdministrators
    ) : managementScreen === ManagementScreens.GroupRemovedUsers ? (
      HeaderContent.ManageGroupRemovedUsers
    ) : managementScreen === ManagementScreens.ChannelRemovedUsers ? (
      HeaderContent.ManageChannelRemovedUsers
    ) : managementScreen === ManagementScreens.GroupUserPermissionsCreate ? (
      HeaderContent.ManageGroupUserPermissionsCreate
    ) : managementScreen === ManagementScreens.GroupUserPermissions ? (
      HeaderContent.ManageGroupUserPermissions
    ) : managementScreen === ManagementScreens.GroupRecentActions ? (
      HeaderContent.ManageGroupRecentActions
    ) : managementScreen === ManagementScreens.ChatAdminRights ? (
      HeaderContent.ManageGroupAdminRights
    ) : managementScreen === ManagementScreens.ChatNewAdminRights ? (
      HeaderContent.ManageGroupNewAdminRights
    ) : managementScreen === ManagementScreens.GroupMembers ? (
      HeaderContent.ManageGroupMembers
    ) : managementScreen === ManagementScreens.Invites ? (
      HeaderContent.ManageInvites
    ) : managementScreen === ManagementScreens.EditInvite ? (
      HeaderContent.ManageEditInvite
    ) : managementScreen === ManagementScreens.GroupAddAdmins ? (
      HeaderContent.ManageGroupAddAdmins
    ) : managementScreen === ManagementScreens.Reactions ? (
      HeaderContent.ManageReactions
    ) : managementScreen === ManagementScreens.InviteInfo ? (
      HeaderContent.ManageInviteInfo
    ) : managementScreen === ManagementScreens.JoinRequests ? (
      HeaderContent.ManageJoinRequests
    ) : managementScreen === ManagementScreens.NewDiscussionGroup ? (
      HeaderContent.NewDiscussionGroup
    ) : undefined // Never reached
  ) : isCreatingTopic ? (
    HeaderContent.CreateTopic
  ) : isEditingTopic ? (
    HeaderContent.EditTopic
  ) : undefined; // When column is closed

  const renderingContentKey = useCurrentOrPrev(contentKey, true) ?? -1;

  function getHeaderTitle() {
    if (isOwnProfile) {
      return lang('MyProfileHeader');
    }

    if (isSavedMessages) {
      return lang('NoteToSelf');
    }

    if (isInsideTopic) {
      return lang('AccDescrTopic');
    }

    if (isChannel) {
      return lang('ChannelTitleInfo');
    }

    if (userId) {
      return lang('InfoUserTitle');
    }

    return lang('GroupInfoTitle');
  }

  const primaryEditButton = canEditTopic ? (
    <Button
      round
      color="translucent"
      size="smaller"
      ariaLabel={lang('EditTopic')}
      onClick={toggleEditTopic}
      iconName="edit"
    />
  ) : canManage ? (
    <Button
      round
      color="translucent"
      size="smaller"
      ariaLabel={lang('Edit')}
      onClick={handleToggleManagement}
      iconName="edit"
    />
  ) : undefined;

  function renderHeaderContent() {
    if (renderingContentKey === -1) {
      return undefined;
    }

    switch (renderingContentKey) {
      case HeaderContent.PollResults:
        return <h3 className="title">{lang('PollResults')}</h3>;
      case HeaderContent.AddingMembers:
        return <h3 className="title">{lang(isChannel ? 'ChannelAddSubscribers' : 'GroupAddMembers')}</h3>;
      case HeaderContent.ManageInitial:
        return <h3 className="title">{lang('Edit')}</h3>;
      case HeaderContent.ManageChatPrivacyType:
        return <h3 className="title">{lang(isChannel ? 'ChannelTypeHeader' : 'GroupTypeHeader')}</h3>;
      case HeaderContent.ManageDiscussion:
        return <h3 className="title">{lang('Discussion')}</h3>;
      case HeaderContent.ManageChatAdministrators:
        return <h3 className="title">{lang('ChannelAdministrators')}</h3>;
      case HeaderContent.ManageGroupRecentActions:
        return <h3 className="title">{lang('GroupInfoAdminLog')}</h3>;
      case HeaderContent.ManageGroupAdminRights:
        return <h3 className="title">{lang('EditAdminRights')}</h3>;
      case HeaderContent.ManageGroupNewAdminRights:
        return <h3 className="title">{lang('SetAsAdmin')}</h3>;
      case HeaderContent.ManageGroupPermissions:
        return <h3 className="title">{lang('ChannelPermissions')}</h3>;
      case HeaderContent.ManageGroupRemovedUsers:
        return <h3 className="title">{lang('BlockedUsers')}</h3>;
      case HeaderContent.ManageChannelRemovedUsers:
        return <h3 className="title">{lang('ChannelBlockedUsers')}</h3>;
      case HeaderContent.ManageGroupUserPermissionsCreate:
        return <h3 className="title">{lang('ChannelAddException')}</h3>;
      case HeaderContent.ManageGroupUserPermissions:
        return <h3 className="title">{lang('UserRestrictions')}</h3>;
      case HeaderContent.ManageInvites:
        return <h3 className="title">{lang('GroupInviteTitle')}</h3>;
      case HeaderContent.ManageEditInvite:
        return <h3 className="title">{isEditingInvite ? lang('EditLink') : lang('NewLink')}</h3>;
      case HeaderContent.ManageInviteInfo:
        return (
          <>
            <h3 className="title">{lang('InviteLink')}</h3>
            <section className="tools">
              {currentInviteInfo && !currentInviteInfo.isRevoked && (
                <Button
                  round
                  color="translucent"
                  size="smaller"
                  ariaLabel={lang('Edit')}
                  onClick={handleEditInviteClick}
                  iconName="edit"
                />
              )}
              {currentInviteInfo && currentInviteInfo.isRevoked && (
                <>
                  <Button
                    round
                    color="danger"
                    size="smaller"
                    ariaLabel={lang('Delete')}
                    onClick={openDeleteDialog}
                    iconName="delete"
                  />
                  <ConfirmDialog
                    isOpen={isDeleteDialogOpen}
                    onClose={closeDeleteDialog}
                    title={lang('DeleteLink')}
                    text={lang('DeleteLinkHelp')}
                    confirmIsDestructive
                    confirmLabel={lang('Delete')}
                    confirmHandler={handleDeleteInviteClick}
                  />
                </>
              )}
            </section>
          </>
        );
      case HeaderContent.ManageJoinRequests:
        return <h3 className="title">{isChannel ? lang('SubscribeRequests') : lang('MemberRequests')}</h3>;
      case HeaderContent.ManageGroupAddAdmins:
        return <h3 className="title">{lang('ChannelManagementAddModerator')}</h3>;
      case HeaderContent.SharedMedia:
        return <h3 className="title">{lang('SharedMedia')}</h3>;
      case HeaderContent.ManageChannelSubscribers:
        return <h3 className="title">{lang('ChannelSubscribers')}</h3>;
      case HeaderContent.MemberList:
      case HeaderContent.ManageGroupMembers:
        return <h3 className="title">{lang('GroupMembers')}</h3>;
      case HeaderContent.StoryList:
        return <h3 className="title">{lang(isSelf ? 'SettingsMyStories' : 'PeerInfoPaneStories')}</h3>;
      case HeaderContent.SavedDialogs:
        return (
          <div className="header">
            <h3 className="title">{lang('NoteToSelf')}</h3>
            <div className="subtitle">
              {lang('ChatsPlural', {
                count: savedDialogsCount,
              }, { pluralValue: savedDialogsCount })}
            </div>
          </div>
        );
      case HeaderContent.ManageReactions:
        return <h3 className="title">{lang('Reactions')}</h3>;
      case HeaderContent.CreateTopic:
        return <h3 className="title">{lang('NewTopic')}</h3>;
      case HeaderContent.EditTopic:
        return <h3 className="title">{lang('EditTopic')}</h3>;
      case HeaderContent.NewDiscussionGroup:
        return <h3 className="title">{lang('NewGroup')}</h3>;
      default:
        return (
          <>
            <h3 className="title">
              {getHeaderTitle()}
            </h3>
            <section className="tools">
              {canAddContact && (
                <Button
                  round
                  color="translucent"
                  size="smaller"
                  ariaLabel={lang('AddContact')}
                  onClick={handleAddContact}
                  iconName="add-user"
                />
              )}
              {primaryEditButton}
              {isOwnProfile && (
                <Button
                  round
                  color="translucent"
                  size="smaller"
                  ariaLabel={lang('Edit')}
                  onClick={handleEditProfile}
                  iconName="edit"
                />
              )}
            </section>
          </>
        );
    }
  }

  const isBackButton = isMobile || (
    !isSavedMessages && (
      contentKey === HeaderContent.SharedMedia
      || contentKey === HeaderContent.MemberList
      || contentKey === HeaderContent.StoryList
      || contentKey === HeaderContent.AddingMembers
      || isManagement
    )
  );

  const buttonClassName = buildClassName(
    'animated-close-icon',
    isBackButton && 'state-back',
    (shouldSkipTransition || shouldSkipHistoryAnimations) && 'no-transition',
  );

  return (
    <div
      className={buildClassName('RightHeader', isSecondaryBackground && 'secondary')}
      data-tauri-drag-region={IS_TAURI && IS_MAC_OS ? true : undefined}
    >
      <Button
        className="close-button"
        round
        color="translucent"
        size="smaller"
        onClick={handleClose}
        ariaLabel={isBackButton ? lang('Back') : lang('Close')}
      >
        <div className={buttonClassName} />
      </Button>
      <Transition
        name={(shouldSkipTransition || shouldSkipHistoryAnimations) ? 'none' : 'slideFade'}
        activeKey={renderingContentKey}
      >
        {renderHeaderContent()}
      </Transition>
    </div>
  );
};

export default withGlobal<OwnProps>(
  (global, {
    chatId, isProfile, isManagement, threadId,
  }): Complete<StateProps> => {
    const tabState = selectTabState(global);
    const chat = chatId ? selectChat(global, chatId) : undefined;
    const user = isProfile && chatId && isUserId(chatId) ? selectUser(global, chatId) : undefined;
    const isChannel = chat && isChatChannel(chat);
    const isInsideTopic = chat?.isForum && Boolean(threadId && threadId !== MAIN_THREAD_ID);
    const topic = isInsideTopic ? selectTopic(global, chatId!, threadId!) : undefined;
    const canEditTopic = isInsideTopic && topic && getCanManageTopic(chat, topic);
    const isOwnProfile = tabState.chatInfo?.isOwnProfile;
    const isSavedMessages = chatId && !isOwnProfile ? selectIsChatWithSelf(global, chatId) : undefined;

    const canAddContact = user && getCanAddContact(user);
    const canManage = Boolean(!isManagement && isProfile && chatId && selectCanManage(global, chatId));

    const isEditingInvite = Boolean(chatId && tabState.management.byChatId[chatId]?.editingInvite);
    const currentInviteInfo = chatId
      ? tabState.management.byChatId[chatId]?.inviteInfo?.invite : undefined;

    return {
      canManage,
      canAddContact,
      isChannel,
      isInsideTopic,
      canEditTopic,
      userId: user?.id,
      isSelf: user?.isSelf,
      isEditingInvite,
      currentInviteInfo,
      isSavedMessages,
      shouldSkipHistoryAnimations: tabState.shouldSkipHistoryAnimations,
      isOwnProfile,
    };
  },
)(RightHeader);
