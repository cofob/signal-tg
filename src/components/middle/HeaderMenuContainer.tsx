import {
  memo, useEffect, useMemo, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type {
  ApiChat,
} from '../../api/types';
import type { IAnchorPosition, ThreadId } from '../../types';
import { MAIN_THREAD_ID } from '../../api/types';

import { UNMUTE_TIMESTAMP } from '../../config';
import {
  getCanAddContact,
  getCanDeleteChat,
  getCanManageTopic,
  getHasAdminRight,
  getIsSavedDialog,
  isChatAdmin,
  isChatChannel,
  isChatGroup,
  isUserRightBanned,
} from '../../global/helpers';
import { getIsChatMuted } from '../../global/helpers/notifications';
import {
  selectCanManage,
  selectCanManageAutoDelete,
  selectChat,
  selectChatFullInfo,
  selectChatHistoryTtl,
  selectCurrentMessageList,
  selectIsChatRestricted,
  selectIsChatWithSelf,
  selectIsCurrentUserFrozen,
  selectIsRightColumnShown,
  selectNotifyDefaults,
  selectNotifyException,
  selectTabState,
  selectTopic,
  selectUser,
  selectUserFullInfo,
} from '../../global/selectors';
import { isUserId } from '../../util/entities/ids';
import { disableScrolling } from '../../util/scrollLock';
import { buildAutoDeletePeriodOptions, DEFAULT_AUTO_DELETE_PERIODS } from '../common/helpers/autoDeletePeriods';

import useAppLayout from '../../hooks/useAppLayout';
import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import usePrevDuringAnimation from '../../hooks/usePrevDuringAnimation';
import useShowTransitionDeprecated from '../../hooks/useShowTransitionDeprecated';

import DeleteChatModal from '../common/DeleteChatModal';
import AutoDeleteOutlinedIcon from '../common/icons/AutoDeleteOutlinedIcon';
import MuteChatModal from '../left/MuteChatModal.async';
import Menu from '../ui/Menu';
import MenuItem from '../ui/MenuItem';
import MenuSeparator from '../ui/MenuSeparator';
import NestedMenuItem from '../ui/NestedMenuItem';
import Portal from '../ui/Portal';

import './HeaderMenuContainer.scss';

export type OwnProps = {
  chatId: string;
  threadId: ThreadId;
  isOpen: boolean;
  anchor: IAnchorPosition;
  isChannel?: boolean;
  canSubscribe?: boolean;
  canSearch?: boolean;
  canMute?: boolean;
  withForumActions?: boolean;
  canLeave?: boolean;
  pendingJoinRequests?: number;
  channelMonoforumId?: string;
  onSearchClick: () => void;
  onAsMessagesClick: () => void;
  onClose: () => void;
  onCloseAnimationEnd: () => void;
  onJoinRequestsClick?: () => void;
};

type StateProps = {
  chat?: ApiChat;
  isPrivate?: boolean;
  isMuted?: boolean;
  isTopic?: boolean;
  isForum?: boolean;
  isForumAsMessages?: true;
  canAddContact?: boolean;
  canDeleteChat?: boolean;
  canReportChat?: boolean;
  canCreateTopic?: boolean;
  canEditTopic?: boolean;
  hasLinkedChat?: boolean;
  isChatInfoShown?: boolean;
  isRightColumnShown?: boolean;
  canManage?: boolean;
  isBlocked?: boolean;
  isChatWithSelf?: boolean;
  savedDialog?: ApiChat;
  isAccountFrozen?: boolean;
  noForwardsMyEnabled?: boolean;
  noForwardsPeerEnabled?: boolean;
  canManageAutoDelete?: boolean;
  historyTtl?: number;
};

const CLOSE_MENU_ANIMATION_DURATION = 200;

const HeaderMenuContainer = ({
  chatId,
  threadId,
  isOpen,
  anchor,
  isChannel,
  canSubscribe,
  withForumActions,
  isTopic,
  isForum,
  isForumAsMessages,
  isChatInfoShown,
  canReportChat,
  canSearch,
  canMute,
  pendingJoinRequests,
  canLeave,
  chat,
  isPrivate,
  isMuted,
  canDeleteChat,
  hasLinkedChat,
  canAddContact,
  canCreateTopic,
  canEditTopic,
  canManage,
  isRightColumnShown,
  isBlocked,
  isChatWithSelf,
  savedDialog,
  isAccountFrozen,
  noForwardsMyEnabled,
  noForwardsPeerEnabled,
  canManageAutoDelete,
  historyTtl,
  channelMonoforumId,
  onJoinRequestsClick,
  onSearchClick,
  onAsMessagesClick,
  onClose,
  onCloseAnimationEnd,
}: OwnProps & StateProps) => {
  const {
    updateChatMutedState,
    enterMessageSelectMode,
    joinChannel,
    openLinkedChat,
    openAddContactDialog,
    openFrozenAccountModal,
    openThreadWithInfo,
    openCreateTopicPanel,
    openEditTopicPanel,
    openChat,
    toggleManagement,
    blockUser,
    unblockUser,
    setViewForumAsMessages,
    reportMessages,
    toggleNoForwards,
    openDisableSharingAboutModal,
    setChatHistoryTtl,
    openAutoDeleteTimerModal,
  } = getActions();

  const lang = useLang();

  const { isMobile } = useAppLayout();
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [shouldCloseFast, setShouldCloseFast] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isMuteModalOpen, setIsMuteModalOpen] = useState(false);
  const [shouldRenderMuteModal, markRenderMuteModal, unmarkRenderMuteModal] = useFlag();
  const { x, y } = anchor;

  useShowTransitionDeprecated(isOpen, onCloseAnimationEnd, undefined, false);
  const isViewGroupInfoShown = usePrevDuringAnimation(
    (!isChatInfoShown && isForum) ? true : undefined, CLOSE_MENU_ANIMATION_DURATION,
  );
  const viewInfoLangKey = isTopic ? 'HeaderMenuViewTopicInfo' : 'HeaderMenuViewGroupInfo';

  const closeMuteModal = useLastCallback(() => {
    setIsMuteModalOpen(false);
    onClose();
  });

  const handleReport = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      setIsMenuOpen(false);
      reportMessages({ chatId, messageIds: [] });
    }
    onClose();
  });

  const handleDelete = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      onClose();
    } else {
      setIsDeleteModalOpen(true);
    }
    setIsMenuOpen(false);
  });

  const closeMenu = useLastCallback(() => {
    setIsMenuOpen(false);
    onClose();
  });

  const handleViewGroupInfo = useLastCallback(() => {
    openThreadWithInfo({ chatId, threadId });
    setShouldCloseFast(!isRightColumnShown);
    closeMenu();
  });

  const closeDeleteModal = useLastCallback(() => {
    setIsDeleteModalOpen(false);
    onClose();
  });

  const handleUnmuteClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      updateChatMutedState({ chatId, mutedUntil: UNMUTE_TIMESTAMP });
    }
    closeMenu();
  });

  const handleMuteClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      closeMenu();
    } else {
      markRenderMuteModal();
      setIsMuteModalOpen(true);
    }
    setIsMenuOpen(false);
  });

  const handleCreateTopicClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openCreateTopicPanel({ chatId });
      setShouldCloseFast(!isRightColumnShown);
    }
    closeMenu();
  });

  const handleEditClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      toggleManagement({ force: true });
      setShouldCloseFast(!isRightColumnShown);
    }
    closeMenu();
  });

  const handleEditTopicClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openEditTopicPanel({ chatId, topicId: Number(threadId) });
      setShouldCloseFast(!isRightColumnShown);
    }
    closeMenu();
  });

  const handleViewAsTopicsClick = useLastCallback(() => {
    openChat({ id: undefined });
    setViewForumAsMessages({ chatId, isEnabled: false });
    closeMenu();
  });

  const handleLinkedChatClick = useLastCallback(() => {
    openLinkedChat({ id: chatId });
    closeMenu();
  });

  const handleAddContactClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openAddContactDialog({ userId: chatId });
    }
    closeMenu();
  });

  const handleSearch = useLastCallback(() => {
    onSearchClick();
    closeMenu();
  });

  const handleSelectMessages = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      enterMessageSelectMode();
    }
    closeMenu();
  });

  const handleOpenAsMessages = useLastCallback(() => {
    onAsMessagesClick();
    closeMenu();
  });

  const handleBlock = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      blockUser({ userId: chatId });
    }
    closeMenu();
  });

  const handleUnblock = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      unblockUser({ userId: chatId });
    }
    closeMenu();
  });

  const handleToggleNoForwards = useLastCallback(() => {
    closeMenu();
    if (isAccountFrozen) {
      openFrozenAccountModal();
      return;
    }

    if (noForwardsMyEnabled || noForwardsPeerEnabled) {
      toggleNoForwards({ userId: chatId, isEnabled: false });
      return;
    }

    openDisableSharingAboutModal({ userId: chatId });
  });

  const handleSubscribe = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      joinChannel({ chatId });
    }
    closeMenu();
  });

  const handleAutoDeletePeriodSelect = useLastCallback((e: React.SyntheticEvent, period?: number) => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else if (period !== (historyTtl ?? 0)) {
      setChatHistoryTtl({ chatId, period: period! });
    }
    closeMenu();
  });

  const handleSetCustomAutoDeleteTime = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openAutoDeleteTimerModal({ chatId });
    }
    closeMenu();
  });

  const handleSendChannelMessage = useLastCallback(() => {
    openChat({ id: channelMonoforumId });
    closeMenu();
  });

  useEffect(disableScrolling, []);

  const autoDeleteOptions = useMemo(() => {
    if (!canManageAutoDelete) return undefined;

    return buildAutoDeletePeriodOptions(lang, DEFAULT_AUTO_DELETE_PERIODS, historyTtl, lang('AutoDeleteNever'));
  }, [canManageAutoDelete, historyTtl, lang]);

  const deleteTitle = useMemo(() => {
    if (!chat) return undefined;

    if (savedDialog) {
      return lang('Delete');
    }

    if (isPrivate) {
      return lang('DeleteChat');
    }

    if (canDeleteChat) {
      return lang('GroupInfoDeleteAndExit');
    }

    if (isChannel) {
      return lang('ChannelLeave');
    }

    return lang('GroupLeaveGroup');
  }, [canDeleteChat, chat, isChannel, isPrivate, savedDialog, lang]);

  return (
    <Portal>
      <div className="HeaderMenuContainer">
        <Menu
          isOpen={isMenuOpen}
          positionX="right"
          style={`left: ${x}px;top: ${y}px;`}
          onClose={closeMenu}
          shouldCloseFast={shouldCloseFast}
        >
          {isMobile && canSearch && (
            <MenuItem
              icon="search"
              onClick={handleSearch}
            >
              {lang('Search')}
            </MenuItem>
          )}
          {withForumActions && canCreateTopic && (
            <>
              <MenuItem
                icon="message"
                onClick={handleCreateTopicClick}
              >
                {lang('ForumCreateTopic')}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          {canSubscribe && (
            <MenuItem
              icon={isChannel ? 'channel' : 'group'}
              onClick={handleSubscribe}
            >
              {lang(isChannel ? 'ProfileJoinChannel' : 'ProfileJoinGroup')}
            </MenuItem>
          )}
          {channelMonoforumId && (
            <MenuItem
              icon="message"
              onClick={handleSendChannelMessage}
            >
              {lang('ChannelSendMessage')}
            </MenuItem>
          )}
          {isViewGroupInfoShown && (
            <MenuItem
              icon="info"
              onClick={handleViewGroupInfo}
            >
              {lang(viewInfoLangKey)}
            </MenuItem>
          )}
          {canManage && !canEditTopic && (
            <MenuItem
              icon="edit"
              onClick={handleEditClick}
            >
              {lang('Edit')}
            </MenuItem>
          )}
          {canEditTopic && (
            <MenuItem
              icon="edit"
              onClick={handleEditTopicClick}
            >
              {lang('ForumTopicEdit')}
            </MenuItem>
          )}
          {isMobile && !withForumActions && isForum && !isTopic && (
            <MenuItem
              icon="forums"
              onClick={handleViewAsTopicsClick}
            >
              {lang('ChatContextViewAsTopics')}
            </MenuItem>
          )}
          {withForumActions && Boolean(pendingJoinRequests) && (
            <MenuItem
              icon="user"
              onClick={onJoinRequestsClick}
            >
              {isChannel ? lang('SubscribeRequests') : lang('MemberRequests')}
              <div className="right-badge">{pendingJoinRequests}</div>
            </MenuItem>
          )}
          {withForumActions && !isTopic && !isForumAsMessages && (
            <MenuItem
              icon="message"
              onClick={handleOpenAsMessages}
            >
              {lang('ForumViewAsMessages')}
            </MenuItem>
          )}
          {canAddContact && (
            <MenuItem
              icon="add-user"
              onClick={handleAddContactClick}
            >
              {lang('AddContact')}
            </MenuItem>
          )}
          {canMute && (isMuted ? (
            <MenuItem
              icon="unmute"
              onClick={handleUnmuteClick}
            >
              {lang('ChatsUnmute')}
            </MenuItem>
          )
            : (
              <MenuItem
                icon="mute"
                onClick={handleMuteClick}
              >
                {lang('ChatsMute')}
                ...
              </MenuItem>
            )
          )}
          {autoDeleteOptions && (
            <NestedMenuItem
              customIcon={<AutoDeleteOutlinedIcon period={historyTtl ?? 0} />}
              submenu={(
                <>
                  {autoDeleteOptions.map(({ label, value }) => {
                    const period = Number(value);
                    return (
                      <MenuItem
                        key={value}
                        icon={period === (historyTtl ?? 0) ? 'check' : 'placeholder'}
                        clickArg={period}
                        onClick={handleAutoDeletePeriodSelect}
                      >
                        {label}
                      </MenuItem>
                    );
                  })}
                  <MenuItem
                    icon="tools"
                    onClick={handleSetCustomAutoDeleteTime}
                  >
                    {lang('SetCustomTime')}
                  </MenuItem>
                </>
              )}
            >
              {lang('AutoDeletePopupTitle')}
            </NestedMenuItem>
          )}
          {hasLinkedChat && (
            <MenuItem
              icon={isChannel ? 'message' : 'channel'}
              onClick={handleLinkedChatClick}
            >
              {lang(isChannel ? 'ViewDiscussion' : 'ProfileViewChannel')}
            </MenuItem>
          )}
          {!withForumActions && (
            <MenuItem
              icon="select"
              onClick={handleSelectMessages}
            >
              {lang('ReportSelectMessages')}
            </MenuItem>
          )}
          {canReportChat && (
            <MenuItem
              icon="flag"
              onClick={handleReport}
            >
              {lang('ReportPeerReport')}
            </MenuItem>
          )}
          {isPrivate && !isChatWithSelf && (
            <MenuItem
              icon={noForwardsMyEnabled || noForwardsPeerEnabled ? 'allow-share' : 'no-share'}
              onClick={handleToggleNoForwards}
            >
              {noForwardsMyEnabled || noForwardsPeerEnabled ? lang('EnableSharing') : lang('DisableSharing')}
            </MenuItem>
          )}
          {isPrivate && !isChatWithSelf && (
            <MenuItem
              icon={isBlocked ? 'user' : 'hand-stop'}
              onClick={isBlocked ? handleUnblock : handleBlock}
            >
              {isBlocked ? lang('Unblock') : lang('NewContactBlock')}
            </MenuItem>
          )}
          {canLeave && (
            <>
              <MenuSeparator />
              <MenuItem
                destructive
                icon="delete"
                onClick={handleDelete}
              >
                {deleteTitle}
              </MenuItem>
            </>
          )}
        </Menu>
        {chat && (
          <DeleteChatModal
            isOpen={isDeleteModalOpen}
            onClose={closeDeleteModal}
            chat={savedDialog || chat}
            isSavedDialog={Boolean(savedDialog)}
          />
        )}
        {canMute && shouldRenderMuteModal && chat?.id && (
          <MuteChatModal
            isOpen={isMuteModalOpen}
            onClose={closeMuteModal}
            onCloseAnimationEnd={unmarkRenderMuteModal}
            chatId={chat.id}
          />
        )}
      </div>
    </Portal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId, threadId }): Complete<StateProps> => {
    const chat = selectChat(global, chatId);
    const isRestricted = selectIsChatRestricted(global, chatId);
    if (!chat || isRestricted) {
      return {} as Complete<StateProps>;
    }
    const isPrivate = isUserId(chat.id);
    const user = isPrivate ? selectUser(global, chatId) : undefined;
    const canAddContact = user && getCanAddContact(user);
    const isMainThread = threadId === MAIN_THREAD_ID;
    const isChatWithSelf = selectIsChatWithSelf(global, chatId);
    const { chatId: currentChatId, threadId: currentThreadId } = selectCurrentMessageList(global) || {};
    const canReportChat = isMainThread && !user && (isChatChannel(chat) || isChatGroup(chat)) && !isChatAdmin(chat);

    const userFullInfo = isPrivate ? selectUserFullInfo(global, chatId) : undefined;
    const chatFullInfo = !isPrivate ? selectChatFullInfo(global, chatId) : undefined;

    const topic = selectTopic(global, chatId, threadId);
    const canCreateTopic = chat.isForum && (
      !isUserRightBanned(chat, 'manageTopics') || getHasAdminRight(chat, 'manageTopics')
    );
    const canEditTopic = topic && getCanManageTopic(chat, topic);
    const canManage = selectCanManage(global, chatId);

    const isSavedDialog = getIsSavedDialog(chatId, threadId, global.currentUserId);
    const savedDialog = isSavedDialog ? selectChat(global, String(threadId)) : undefined;
    const isAccountFrozen = selectIsCurrentUserFrozen(global);
    const chatInfo = selectTabState(global).chatInfo;
    const canManageAutoDelete = isMainThread && !isSavedDialog && selectCanManageAutoDelete(global, chatId);

    return {
      chat,
      isMuted: getIsChatMuted(chat, selectNotifyDefaults(global), selectNotifyException(global, chat.id)),
      isPrivate,
      isTopic: chat?.isForum && !isMainThread,
      isForum: chat?.isForum,
      isForumAsMessages: chat?.isForumAsMessages,
      canAddContact,
      canDeleteChat: getCanDeleteChat(chat),
      canReportChat,
      hasLinkedChat: Boolean(chatFullInfo?.linkedChatId),
      isChatInfoShown: chatInfo.isOpen && currentChatId === chatId && currentThreadId === threadId,
      canCreateTopic,
      canEditTopic,
      canManage,
      isRightColumnShown: selectIsRightColumnShown(global),
      isBlocked: userFullInfo?.isBlocked,
      isChatWithSelf,
      savedDialog,
      isAccountFrozen,
      noForwardsMyEnabled: userFullInfo?.noForwardsMyEnabled,
      noForwardsPeerEnabled: userFullInfo?.noForwardsPeerEnabled,
      canManageAutoDelete,
      historyTtl: canManageAutoDelete ? selectChatHistoryTtl(global, chatId) : undefined,
    };
  },
)(HeaderMenuContainer));
