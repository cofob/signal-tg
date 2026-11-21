import {
  memo, useCallback, useMemo,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type {
  ApiChat,
  ApiDraft,
  ApiTypingStatus,
  ApiUser,
  ApiUserStatus,
} from '../../../api/types';
import type { GlobalState } from '../../../global/types';
import type { ObserveFn } from '../../../hooks/useIntersectionObserver';
import type { ChatAnimationTypes } from './hooks';
import { MAIN_THREAD_ID } from '../../../api/types';
import { StoryViewerOrigin } from '../../../types';

import { UNMUTE_TIMESTAMP } from '../../../config';
import {
  getPeerColorKey,
  groupStatefulContent,
  isUserOnline,
} from '../../../global/helpers';
import { getIsChatMuted } from '../../../global/helpers/notifications';
import {
  selectCanAnimateInterface,
  selectChat,
  selectChatLastMessageInfo,
  selectCurrentMessageList,
  selectIsCurrentUserFrozen,
  selectNotifyDefaults,
  selectNotifyException,
  selectUser,
  selectUserStatus,
} from '../../../global/selectors';
import { selectDraft, selectThreadLocalStateParam } from '../../../global/selectors/threads';
import { IS_OPEN_IN_NEW_TAB_SUPPORTED } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';
import { formatCountdown } from '../../../util/dates/duration';
import { isUserId } from '../../../util/entities/ids';
import { createLocationHash } from '../../../util/routing';

import { useShallowSelector } from '../../../hooks/data/useSelector';
import useAppLayout from '../../../hooks/useAppLayout';
import useChatContextActions from '../../../hooks/useChatContextActions';
import useEnsureMessage from '../../../hooks/useEnsureMessage';
import useFlag from '../../../hooks/useFlag';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import { getPeerColorClass } from '../../../hooks/usePeerColor';
import useShowTransitionDeprecated from '../../../hooks/useShowTransitionDeprecated';
import useChatListEntry from './hooks/useChatListEntry';

import Avatar from '../../common/Avatar';
import DeleteChatModal from '../../common/DeleteChatModal';
import FullNameTitle from '../../common/FullNameTitle';
import AutoDeleteIcon from '../../common/icons/AutoDeleteIcon';
import Icon from '../../common/icons/Icon';
import LastMessageMeta from '../../common/LastMessageMeta';
import ListItem from '../../ui/ListItem';
import ChatFolderModal from '../ChatFolderModal.async';
import MuteChatModal from '../MuteChatModal.async';
import ChatBadge from './ChatBadge';

import './Chat.scss';

type OwnProps = {
  chatId: string;
  folderId?: number;
  orderDiff: number;
  shiftDiff: number;
  animationType: ChatAnimationTypes;
  isPinned?: boolean;
  offsetTop?: number;
  isPreview?: boolean;
  previewMessageId?: number;
  className?: string;
  observeIntersection?: ObserveFn;
  onReorderAnimationEnd?: NoneToVoidFunction;
};

type StateProps = {
  chat?: ApiChat;
  isMuted?: boolean;
  user?: ApiUser;
  userStatus?: ApiUserStatus;
  draft?: ApiDraft;
  isSelected?: boolean;
  canScrollDown?: boolean;
  canChangeFolder?: boolean;
  typingStatusByPeerId?: Record<string, ApiTypingStatus>;
  withInterfaceAnimations?: boolean;
  isAccountFrozen?: boolean;
};

const AUTO_DELETE_STORY_GAP_PERCENT = 15;

const Chat = ({
  chatId,
  folderId,
  orderDiff,
  shiftDiff,
  animationType,
  isPinned,
  observeIntersection,
  chat,
  isMuted,
  user,
  userStatus,
  offsetTop,
  draft,
  withInterfaceAnimations,
  isSelected,
  canScrollDown,
  canChangeFolder,
  typingStatusByPeerId,
  isPreview,
  previewMessageId,
  className,
  isAccountFrozen,
  onReorderAnimationEnd,
}: OwnProps & StateProps) => {
  const {
    openChat,
    focusMessage,
    setShouldCloseRightColumn,
    openFrozenAccountModal,
    updateChatMutedState,
    openQuickPreview,
    scrollMessageListToBottom,
  } = getActions();

  const lang = useLang();

  const { isMobile } = useAppLayout();
  const [isDeleteModalOpen, openDeleteModal, closeDeleteModal] = useFlag();
  const [isMuteModalOpen, openMuteModal, closeMuteModal] = useFlag();
  const [isChatFolderModalOpen, openChatFolderModal, closeChatFolderModal] = useFlag();
  const [shouldRenderDeleteModal, markRenderDeleteModal, unmarkRenderDeleteModal] = useFlag();
  const [shouldRenderMuteModal, markRenderMuteModal, unmarkRenderMuteModal] = useFlag();
  const [shouldRenderChatFolderModal, markRenderChatFolderModal, unmarkRenderChatFolderModal] = useFlag();

  const lastMessageInfoSelector = useCallback((global: GlobalState) => selectChatLastMessageInfo(global, {
    chatId, previewMessageId,
  }), [chatId, previewMessageId]);
  const {
    lastMessage, lastMessageId, lastMessageSender, lastMessageOutgoingStatus, lastMessageStory,
  } = useShallowSelector(lastMessageInfoSelector);

  useEnsureMessage(chatId, lastMessageId, lastMessage);

  const { renderSubtitle, ref } = useChatListEntry({
    chat,
    chatId,
    lastMessage,
    typingStatusByPeerId,
    draft,
    statefulMediaContent: groupStatefulContent({ story: lastMessageStory }),
    lastMessageSender,
    observeIntersection,
    animationType,
    withInterfaceAnimations,
    orderDiff,
    shiftDiff,
    isPreview,
    onReorderAnimationEnd,
  });

  const openChatEntry = useLastCallback(() => {
    if (isMobile) {
      setShouldCloseRightColumn({ value: true });
    }

    if (isPreview) {
      focusMessage({
        chatId,
        messageId: previewMessageId!,
      });
      return false;
    }

    openChat({ id: chatId, shouldReplaceHistory: true }, { forceOnHeavyAnimation: true });

    return true;
  });

  const handleClick = useLastCallback((e: React.MouseEvent) => {
    if (e.altKey && !isPreview) {
      e.preventDefault();
      openQuickPreview({ id: chatId });
      return;
    }

    if (openChatEntry() && isSelected && canScrollDown && e.detail <= 1) {
      scrollMessageListToBottom();
    }
  });

  const handleDelete = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      return;
    }

    markRenderDeleteModal();
    openDeleteModal();
  });

  const handleMute = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      return;
    }

    markRenderMuteModal();
    openMuteModal();
  });

  const handleUnmute = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      return;
    }

    updateChatMutedState({ chatId, mutedUntil: UNMUTE_TIMESTAMP });
  });

  const handleChatFolderChange = useLastCallback(() => {
    markRenderChatFolderModal();
    openChatFolderModal();
  });

  const contextActions = useChatContextActions({
    chat,
    user,
    handleDelete,
    handleMute,
    handleUnmute,
    handleChatFolderChange,
    folderId,
    isPinned,
    isMuted,
    canChangeFolder,
    isPreview,
  });

  const isOnline = user && userStatus && isUserOnline(user, userStatus);
  const { hasShownClass: isAvatarOnlineShown } = useShowTransitionDeprecated(isOnline);

  const href = useMemo(() => {
    if (!IS_OPEN_IN_NEW_TAB_SUPPORTED) return undefined;

    return `#${createLocationHash(chatId, 'thread', MAIN_THREAD_ID)}`;
  }, [chatId]);

  if (!chat) {
    return undefined;
  }

  const peer = user || chat;
  const avatarPeer = peer;
  const historyTtlText = chat.ttlPeriod ? formatCountdown(lang, chat.ttlPeriod) : undefined;
  const autoDeleteInfoText = historyTtlText
    ? lang('AutoDeleteSetInfo', { time: historyTtlText })
    : undefined;
  const shouldShowAutoDeleteBadge = !isAvatarOnlineShown && Boolean(autoDeleteInfoText);
  const avatarColorClassName = shouldShowAutoDeleteBadge
    ? getPeerColorClass(getPeerColorKey(avatarPeer, true)!)
    : undefined;

  const chatClassName = buildClassName(
    'Chat chat-item-clickable',
    isUserId(chatId) ? 'private' : 'group',
    isSelected && 'selected',
    isPreview && 'standalone',
    className,
  );

  return (
    <ListItem
      ref={ref}
      className={chatClassName}
      href={href}
      style={offsetTop !== undefined ? `top: ${offsetTop}px` : undefined}
      ripple={!isMobile}
      contextActions={contextActions}
      withPortalForMenu
      onClick={handleClick}
      onFileHoverOpen={openChatEntry}
    >
      <div className={buildClassName('status', 'status-clickable')}>
        <div className="avatar-wrapper">
          <Avatar
            peer={avatarPeer}
            isSavedMessages={user?.isSelf}
            size={isPreview ? 'medium' : 'large'}
            withStory={!user?.isSelf}
            withStoryGap={isAvatarOnlineShown || shouldShowAutoDeleteBadge}
            storyGapPercent={shouldShowAutoDeleteBadge ? AUTO_DELETE_STORY_GAP_PERCENT : undefined}
            storyViewerOrigin={StoryViewerOrigin.ChatList}
            storyViewerMode="single-peer"
          />
          <div className="avatar-badge-wrapper">
            <div
              className={buildClassName('avatar-online', 'avatar-badge', isAvatarOnlineShown && 'avatar-online-shown')}
            />
            {shouldShowAutoDeleteBadge && (
              <AutoDeleteIcon
                period={chat.ttlPeriod!}
                peer={avatarPeer}
                className={buildClassName('avatar-badge', avatarColorClassName)}
                ariaLabel={autoDeleteInfoText}
              />
            )}
          </div>
          <ChatBadge
            chat={chat}
            isMuted={isMuted}
            shouldShowOnlyMostImportant
            isSelected={isSelected}
            isOnAvatar
          />
        </div>
      </div>
      <div className="info">
        <div className="info-row">
          <FullNameTitle
            peer={avatarPeer}
            isSavedMessages={chatId === user?.id && user?.isSelf}
          />
          {isMuted && <Icon name="muted" />}
          <div className="separator" />
          {lastMessage && (
            <LastMessageMeta
              message={lastMessage}
              outgoingStatus={lastMessageOutgoingStatus}
              draftDate={draft?.date}
            />
          )}
        </div>
        <div className="subtitle">
          {renderSubtitle()}
          {!isPreview && (
            <ChatBadge
              chat={chat}
              isPinned={isPinned}
              isMuted={isMuted}
              isSelected={isSelected}
              transitionClassName="chat-badge-transition"
            />
          )}
        </div>
      </div>
      {shouldRenderDeleteModal && (
        <DeleteChatModal
          isOpen={isDeleteModalOpen}
          onClose={closeDeleteModal}
          onCloseAnimationEnd={unmarkRenderDeleteModal}
          chat={chat}
        />
      )}
      {shouldRenderMuteModal && (
        <MuteChatModal
          isOpen={isMuteModalOpen}
          onClose={closeMuteModal}
          onCloseAnimationEnd={unmarkRenderMuteModal}
          chatId={chatId}
        />
      )}
      {shouldRenderChatFolderModal && (
        <ChatFolderModal
          isOpen={isChatFolderModalOpen}
          onClose={closeChatFolderModal}
          onCloseAnimationEnd={unmarkRenderChatFolderModal}
          chatId={chatId}
        />
      )}
    </ListItem>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, {
    chatId, isPreview,
  }): Complete<StateProps> => {
    const chat = selectChat(global, chatId);
    const user = selectUser(global, chatId);
    if (!chat) {
      return {} as Complete<StateProps>;
    }

    const {
      chatId: currentChatId,
      threadId: currentThreadId,
      type: currentMessageListType,
    } = selectCurrentMessageList(global) || {};
    const isSelected = !isPreview && chatId === currentChatId && currentThreadId === MAIN_THREAD_ID;

    const userStatus = selectUserStatus(global, chatId);

    const typingStatusByPeerId = selectThreadLocalStateParam(global, chatId, MAIN_THREAD_ID, 'typingStatusByPeerId');

    const isAccountFrozen = selectIsCurrentUserFrozen(global);

    return {
      chat,
      isMuted: getIsChatMuted(chat, selectNotifyDefaults(global), selectNotifyException(global, chat.id)),
      draft: selectDraft(global, chatId, MAIN_THREAD_ID),
      isSelected,
      canScrollDown: isSelected && currentMessageListType === 'thread',
      canChangeFolder: (global.chatFolders.orderedIds?.length || 0) > 1,
      user,
      userStatus,
      typingStatusByPeerId,
      withInterfaceAnimations: selectCanAnimateInterface(global),
      isAccountFrozen,
    };
  },
)(Chat));
