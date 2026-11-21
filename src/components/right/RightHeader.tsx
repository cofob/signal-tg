import {
  useEffect, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiExportedInvite } from '../../api/types';
import type { ThreadId } from '../../types';
import { ManagementScreens, ProfileState, SettingsScreens } from '../../types';

import { ANIMATION_END_DELAY } from '../../config';
import {
  getCanAddContact,
} from '../../global/helpers';
import {
  selectCanManage,
  selectIsChatWithSelf,
  selectTabState,
  selectUser,
} from '../../global/selectors';
import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { IS_MAC_OS } from '../../util/browser/windowEnvironment';
import buildClassName from '../../util/buildClassName';
import { isUserId } from '../../util/entities/ids';

import useAppLayout from '../../hooks/useAppLayout';
import useCurrentOrPrev from '../../hooks/useCurrentOrPrev';
import useFlag from '../../hooks/useFlag';
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
  userId?: string;
  isSelf?: boolean;
  isEditingInvite?: boolean;
  currentInviteInfo?: ApiExportedInvite;
  shouldSkipHistoryAnimations?: boolean;
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
  ManageChatAdministrators,
  ManageGroupPermissions,
  ManageGroupRemovedUsers,
  ManageGroupInvitedUsers,
  ManageGroupUserPermissionsCreate,
  ManageGroupUserPermissions,
  ManageGroupAdminRights,
  ManageGroupNewAdminRights,
  ManageGroupMembers,
  ManageGroupAddAdmins,
  PollResults,
  AddingMembers,
  ManageInvites,
  ManageEditInvite,
  ManageInviteInfo,
  ManageJoinRequests,
}

const RightHeader = ({
  chatId,
  threadId,
  isColumnOpen,
  isProfile,
  isManagement,
  isPollResults,
  isAddingChatMembers,
  headerBackground,
  profileState,
  managementScreen,
  canAddContact,
  userId,
  isSelf,
  canManage,
  isEditingInvite,
  currentInviteInfo,
  shouldSkipHistoryAnimations,
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
    openSettingsScreen,
  } = getActions();

  const [isDeleteDialogOpen, openDeleteDialog, closeDeleteDialog] = useFlag();
  const { isMobile } = useAppLayout();

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
    ) : -1 // Never reached
  ) : isPollResults ? (
    HeaderContent.PollResults
  ) : isAddingChatMembers ? (
    HeaderContent.AddingMembers
  ) : isManagement ? (
    managementScreen === ManagementScreens.Initial ? (
      HeaderContent.ManageInitial
    ) : managementScreen === ManagementScreens.GroupPermissions ? (
      HeaderContent.ManageGroupPermissions
    ) : managementScreen === ManagementScreens.ChatAdministrators ? (
      HeaderContent.ManageChatAdministrators
    ) : managementScreen === ManagementScreens.GroupRemovedUsers ? (
      HeaderContent.ManageGroupRemovedUsers
    ) : managementScreen === ManagementScreens.GroupInvitedUsers ? (
      HeaderContent.ManageGroupInvitedUsers
    ) : managementScreen === ManagementScreens.GroupUserPermissionsCreate ? (
      HeaderContent.ManageGroupUserPermissionsCreate
    ) : managementScreen === ManagementScreens.GroupUserPermissions ? (
      HeaderContent.ManageGroupUserPermissions
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
    ) : managementScreen === ManagementScreens.InviteInfo ? (
      HeaderContent.ManageInviteInfo
    ) : managementScreen === ManagementScreens.JoinRequests ? (
      HeaderContent.ManageJoinRequests
    ) : undefined // Never reached
  ) : undefined; // When column is closed

  const renderingContentKey = useCurrentOrPrev(contentKey, true) ?? -1;

  function getHeaderTitle() {
    if (isOwnProfile) {
      return lang('MyProfileHeader');
    }

    if (isSavedMessages) {
      return lang('NoteToSelf');
    }

    if (userId) {
      return lang('InfoUserTitle');
    }

    return lang('GroupInfoTitle');
  }

  const primaryEditButton = canManage ? (
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
        return <h3 className="title">{lang('GroupAddMembers')}</h3>;
      case HeaderContent.ManageInitial:
        return <h3 className="title">{lang('Edit')}</h3>;
      case HeaderContent.ManageChatAdministrators:
        return <h3 className="title">{lang('ChannelAdministrators')}</h3>;
      case HeaderContent.ManageGroupAdminRights:
        return <h3 className="title">{lang('EditAdminRights')}</h3>;
      case HeaderContent.ManageGroupNewAdminRights:
        return <h3 className="title">{lang('SetAsAdmin')}</h3>;
      case HeaderContent.ManageGroupPermissions:
        return <h3 className="title">{lang('ChannelPermissions')}</h3>;
      case HeaderContent.ManageGroupRemovedUsers:
        return <h3 className="title">{lang('BlockedUsers')}</h3>;
      case HeaderContent.ManageGroupInvitedUsers:
        return <h3 className="title">{lang('GroupPendingInvites')}</h3>;
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
        return <h3 className="title">{lang('MemberRequests')}</h3>;
      case HeaderContent.ManageGroupAddAdmins:
        return <h3 className="title">{lang('ChannelManagementAddModerator')}</h3>;
      case HeaderContent.SharedMedia:
        return <h3 className="title">{lang('SharedMedia')}</h3>;
      case HeaderContent.MemberList:
      case HeaderContent.ManageGroupMembers:
        return <h3 className="title">{lang('GroupMembers')}</h3>;
      case HeaderContent.StoryList:
        return <h3 className="title">{lang(isSelf ? 'SettingsMyStories' : 'PeerInfoPaneStories')}</h3>;
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
    chatId, isProfile, isManagement,
  }): Complete<StateProps> => {
    const tabState = selectTabState(global);
    const user = isProfile && chatId && isUserId(chatId) ? selectUser(global, chatId) : undefined;
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
