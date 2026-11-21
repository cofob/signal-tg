import {
  memo, useCallback, useEffect, useMemo, useState,
} from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type { ApiAvailableReaction,
  ApiChat,
  ApiChatReactions,
  ApiMessage,
  ApiMessagePoll,
  ApiReaction,
  ApiStickerSet,
  ApiTypeStory,
  ApiUser,
  ApiWebPage } from '../../../api/types';
import type { GlobalState } from '../../../global/types';
import type {
  ActiveDownloads,
  IAlbum,
  IAnchorPosition,
  MessageListType,
  ThreadId,
} from '../../../types';
import type { ClipboardTextFormat, MessageCopyRequest } from '../../../types/messageCopy';
import { MAIN_THREAD_ID } from '../../../api/types';

import { PREVIEW_AVATAR_COUNT } from '../../../config';
import {
  areReactionsEmpty,
  getCanPostInChat,
  getCanReplyToEphemeralMessage,
  getIsDownloading,
  getMediaHash,
  getMessageAudio,
  getMessageCustomEmojis,
  getUniqueStickerSetsInfo,
  getUserFullName,
  hasMessageTtl,
  isActionMessage,
  isChatAdmin,
  isChatGroup,
  isMessageLocal,
  isOwnMessage,
  isUserRightBanned,
} from '../../../global/helpers';
import {
  selectActiveDownloads,
  selectAlbumMessageIdToEdit,
  selectAllowedMessageActionsSlow,
  selectCanForwardMessage,
  selectCanPlayAnimatedEmojis,
  selectCanScheduleUntilOnline,
  selectChat,
  selectChatFullInfo,
  selectCustomEmoji,
  selectIsChatWithSelf,
  selectIsFileSaved,
  selectIsMessageProtected,
  selectIsMessageUnread,
  selectIsReactionPickerOpen,
  selectPeerStory,
  selectPollFromMessage,
  selectStickerSet,
  selectUser,
  selectUserFullInfo,
  selectUserStatus,
  selectWebPageFromMessage,
} from '../../../global/selectors';
import { selectMessageDownloadableMedia } from '../../../global/selectors/media';
import buildClassName from '../../../util/buildClassName';
import { copyTextToClipboard } from '../../../util/clipboard';
import { isUserId } from '../../../util/entities/ids';
import { MEMO_EMPTY_ARRAY } from '../../../util/memo';
import { getSelectionAsFormattedText } from './helpers/getSelectionAsFormattedText';
import { getSelectionAsRichQuote } from './helpers/getSelectionAsRichQuote';
import { isSelectionRangeInsideMessage } from './helpers/isSelectionRangeInsideMessage';

import { useShallowSelector } from '../../../hooks/data/useSelector';
import useFlag from '../../../hooks/useFlag';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import useSchedule from '../../../hooks/useSchedule';
import useShowTransition from '../../../hooks/useShowTransition';

import PinMessageModal from '../../common/PinMessageModal.async';
import ConfirmDialog from '../../ui/ConfirmDialog';
import MessageContextMenu from './MessageContextMenu';

export type OwnProps = {
  isOpen: boolean;
  message: ApiMessage;
  album?: IAlbum;
  anchor: IAnchorPosition;
  targetHref?: string;
  messageListType: MessageListType;
  threadId: ThreadId;
  className?: string;
  onClose: NoneToVoidFunction;
  onCloseAnimationEnd: NoneToVoidFunction;
};

type StateProps = {
  poll?: ApiMessagePoll;
  webPage?: ApiWebPage;
  story?: ApiTypeStory;
  chat?: ApiChat;
  availableReactions?: ApiAvailableReaction[];
  topReactions?: ApiReaction[];
  defaultTagReactions?: ApiReaction[];
  noOptions?: boolean;
  canSendNow?: boolean;
  canReschedule?: boolean;
  canReply?: boolean;
  canPin?: boolean;
  canShowReactionsCount?: boolean;
  canShowReactionList?: boolean;
  canUnpin?: boolean;
  canDelete?: boolean;
  canEdit?: boolean;
  canForward?: boolean;
  canCopy?: boolean;
  isPrivate?: boolean;
  hasFullInfo?: boolean;
  canSelect?: boolean;
  canDownload?: boolean;
  canRevote?: boolean;
  canClosePoll?: boolean;
  canViewDetails?: boolean;
  canResend?: boolean;
  canLoadReadDate?: boolean;
  shouldRenderShowWhen?: boolean;
  activeDownloads: ActiveDownloads;
  // The key of the message's file when the desktop app saved it
  savedFileKey?: string;
  canShowSeenBy?: boolean;
  enabledReactions?: ApiChatReactions;
  canScheduleUntilOnline?: boolean;
  reactionsLimit?: number;
  canPlayAnimatedEmojis?: boolean;
  isReactionPickerOpen?: boolean;
  isInSavedMessages?: boolean;
  quoteLengthMax: number;
  canReplyInChat?: boolean;
  user?: ApiUser;
  noForwardsMyEnabled?: boolean;
  noForwardsPeerEnabled?: boolean;
  savedMusicById?: Record<string, true>;
  isSavedMusicLoading?: boolean;
  isMessageProtected: boolean;
};

const selection = window.getSelection();
const UNQUOTABLE_OFFSET = -1;

const ContextMenuContainer = ({
  threadId,
  availableReactions,
  topReactions,
  defaultTagReactions,
  isOpen,
  messageListType,
  message,
  album,
  poll,
  webPage,
  story,
  anchor,
  targetHref,
  noOptions,
  canSendNow,
  hasFullInfo,
  canReschedule,
  canReply,
  canPin,
  canUnpin,
  canDelete,
  canShowReactionsCount,
  chat,
  canShowReactionList,
  canEdit,
  enabledReactions,
  reactionsLimit,
  isPrivate,
  canForward,
  canCopy,
  canSelect,
  canDownload,
  canRevote,
  canClosePoll,
  canPlayAnimatedEmojis,
  canLoadReadDate,
  shouldRenderShowWhen,
  activeDownloads,
  savedFileKey,
  canShowSeenBy,
  canViewDetails,
  canResend,
  canScheduleUntilOnline,
  isReactionPickerOpen,
  isInSavedMessages,
  quoteLengthMax,
  canReplyInChat,
  user,
  className,
  noForwardsMyEnabled,
  noForwardsPeerEnabled,
  savedMusicById,
  isSavedMusicLoading,
  isMessageProtected,
  onClose,
  onCloseAnimationEnd,
}: OwnProps & StateProps) => {
  const {
    updateDraftReplyInfo,
    startEditingMessage,
    pinMessage,
    openForwardMenu,
    openReplyMenu,
    toggleMessageSelection,
    sendScheduledMessages,
    rescheduleMessage,
    downloadMedia,
    cancelMediaDownload,
    openSavedFile,
    showSavedFileInFolder,
    loadSeenBy,
    openSeenByModal,
    openMessageDetailsModal,
    resendMessage,
    openReactorListModal,
    loadFullChat,
    loadReactors,
    copyMessagesByIds,
    loadStickers,
    cancelPollVote,
    closePoll,
    toggleReaction,
    openMessageReactionPicker,
    loadOutboxReadDate,
    openDeleteMessageModal,
    deleteEphemeralMessage,
    loadRichMessage,
    loadSavedMusicIds,
    toggleMusicInProfile,
  } = getActions();

  const lang = useLang();
  const userFullName = getUserFullName(lang, user);

  const noForwardsNotice = noForwardsPeerEnabled
    ? lang('ContextMenuNoForwardsPeer', { name: userFullName })
    : (noForwardsMyEnabled ? lang('ContextMenuNoForwardsYou') : undefined);

  const { ref: containerRef } = useShowTransition({
    isOpen,
    onCloseAnimationEnd,
    className: false,
  });
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isClosePollDialogOpen, openClosePollDialog, closeClosePollDialog] = useFlag();
  const [selectionQuoteOffset, setSelectionQuoteOffset] = useState(UNQUOTABLE_OFFSET);
  const [selectedRichQuote, setSelectedRichQuote] = useState<ReturnType<typeof getSelectionAsRichQuote>>();
  const [requestCalendar, calendar] = useSchedule(
    canScheduleUntilOnline,
    onClose,
    message.date,
  );

  const customEmojis = useMemo(() => (
    message.isEphemeral ? MEMO_EMPTY_ARRAY : getMessageCustomEmojis(message)
  ), [message]);
  const customEmojiDocumentsSelector = useCallback((global: GlobalState) => customEmojis.map((emoji) => (
    ('document' in emoji && emoji.document) || selectCustomEmoji(global, emoji.documentId)
  )), [customEmojis]);
  const customEmojiDocuments = useShallowSelector(customEmojiDocumentsSelector);
  const customEmojiSetsInfo = useMemo(() => (
    // If some emoji are still loading, do not return an empty array
    customEmojiDocuments.every(Boolean)
      ? getUniqueStickerSetsInfo(customEmojiDocuments.map((document) => document.stickerSetInfo))
      : undefined
  ), [customEmojiDocuments]);
  const customEmojiSetsSelector = useCallback((global: GlobalState) => (
    customEmojiSetsInfo?.map((set) => selectStickerSet(global, set))
  ), [customEmojiSetsInfo]);
  const customEmojiSetsNotFiltered = useShallowSelector(customEmojiSetsSelector);
  const customEmojiSets = customEmojiSetsNotFiltered?.every<ApiStickerSet>(Boolean)
    ? customEmojiSetsNotFiltered : undefined;

  // `undefined` indicates that emoji are present and loading
  const hasCustomEmoji = !message.isEphemeral
    && (customEmojiSetsInfo === undefined || Boolean(customEmojiSetsInfo.length));
  const audio = getMessageAudio(message);
  const isLocalMessage = isMessageLocal(message);
  const canManageMusicInProfile = Boolean(audio && !isLocalMessage && !isMessageProtected);
  const isMusicProfileStatusLoaded = Boolean(savedMusicById);
  const isMusicSaved = Boolean(audio && savedMusicById?.[audio.id]);

  useEffect(() => {
    if (isOpen && canManageMusicInProfile && !savedMusicById && !isSavedMusicLoading) {
      loadSavedMusicIds();
    }
  }, [canManageMusicInProfile, isOpen, isSavedMusicLoading, loadSavedMusicIds, savedMusicById]);

  useEffect(() => {
    if (canShowSeenBy && isOpen) {
      loadSeenBy({ chatId: message.chatId, messageId: message.id });
    }
  }, [loadSeenBy, isOpen, message.chatId, message.id, canShowSeenBy]);

  useEffect(() => {
    if (canEdit && isOpen && message.content.richMessage?.isPart) {
      loadRichMessage({
        chatId: message.chatId,
        messageId: message.id,
        isScheduled: messageListType === 'scheduled' || undefined,
      });
    }
  }, [
    canEdit, isOpen, loadRichMessage, message.chatId, message.content.richMessage?.isPart, message.id, messageListType,
  ]);

  useEffect(() => {
    if (canLoadReadDate && isOpen) {
      loadOutboxReadDate({ chatId: message.chatId, messageId: message.id });
    }
  }, [canLoadReadDate, isOpen, message.chatId, message.id, message.readDate]);

  useEffect(() => {
    if (canShowReactionsCount && isOpen) {
      loadReactors({ chatId: message.chatId, messageId: message.id });
    }
  }, [canShowReactionsCount, isOpen, loadReactors, message.chatId, message.id]);

  useEffect(() => {
    if (customEmojiSetsInfo?.length && customEmojiSets?.length !== customEmojiSetsInfo.length) {
      customEmojiSetsInfo.forEach((set) => {
        loadStickers({ stickerSetInfo: set });
      });
    }
  }, [customEmojiSetsInfo, customEmojiSets, loadStickers]);

  useEffect(() => {
    if (!hasFullInfo && !isPrivate && isOpen) {
      loadFullChat({ chatId: message.chatId });
    }
  }, [hasFullInfo, isOpen, isPrivate, loadFullChat, message.chatId]);

  const seenByRecentPeers = useMemo(() => {
    // No need for expensive global updates on chats or users, so we avoid them
    const chatsById = getGlobal().chats.byId;
    const usersById = getGlobal().users.byId;
    if (message.reactions?.recentReactions?.length) {
      const uniqueReactors = new Set(message.reactions?.recentReactions?.map(
        ({ peerId }) => usersById[peerId] || chatsById[peerId],
      ));

      return Array.from(uniqueReactors).filter(Boolean).slice(0, PREVIEW_AVATAR_COUNT);
    }

    if (!message.seenByDates) {
      return undefined;
    }

    return Object.keys(message.seenByDates).slice(0, PREVIEW_AVATAR_COUNT)
      .map((id) => usersById[id] || chatsById[id])
      .filter(Boolean);
  }, [message.reactions?.recentReactions, message.seenByDates]);

  const isDownloading = useMemo(() => {
    const global = getGlobal();
    if (album) {
      return album.messages.some((msg) => {
        const downloadableMedia = selectMessageDownloadableMedia(global, msg);
        if (!downloadableMedia) return false;
        return getIsDownloading(activeDownloads, downloadableMedia);
      });
    }

    const downloadableMedia = selectMessageDownloadableMedia(global, message);
    if (!downloadableMedia) return false;
    return getIsDownloading(activeDownloads, downloadableMedia);
  }, [activeDownloads, album, message]);

  const selectionRange = canReply && selection?.rangeCount ? selection.getRangeAt(0) : undefined;

  useEffect(() => {
    setSelectedRichQuote(undefined);
    if (message.content.richMessage) {
      const richQuote = selectionRange && !message.isEphemeral
        ? getSelectionAsRichQuote(selectionRange, message.content.richMessage, message.id, quoteLengthMax) : undefined;
      setSelectedRichQuote(richQuote);
      setSelectionQuoteOffset(richQuote?.quoteOffset ?? UNQUOTABLE_OFFSET);
      return;
    }

    const isMessageTextSelected = selectionRange
      && !selectionRange.collapsed
      && Boolean(message.content.text?.text)
      && isSelectionRangeInsideMessage(selectionRange);

    if (!isMessageTextSelected) {
      setSelectionQuoteOffset(UNQUOTABLE_OFFSET);
      return;
    }

    const selectionText = getSelectionAsFormattedText(selectionRange);

    const messageText = message.content.text!.text.replace(/\u00A0/g, ' ');

    const canQuote = selectionText.text.trim().length > 0
      && messageText.includes(selectionText.text);
    if (!canQuote) {
      setSelectionQuoteOffset(UNQUOTABLE_OFFSET);
      return;
    }

    setSelectionQuoteOffset(selectionRange.startOffset);
  }, [
    selectionRange, selectionRange?.collapsed, selectionRange?.startOffset, selectionRange?.endOffset,
    message.content.text, message.content.richMessage, message.id, message.isEphemeral,
    quoteLengthMax,
  ]);

  const closeMenu = useLastCallback(() => {
    setIsMenuOpen(false);
    onClose();
  });

  const handleDelete = useLastCallback(() => {
    setIsMenuOpen(false);
    closeMenu();
    if (message.isEphemeral) {
      deleteEphemeralMessage({
        chatId: message.chatId,
        messageId: message.id,
      });
      return;
    }

    const messageIds = album?.messages
      ? album.messages.map(({ id }) => id)
      : [message.id];
    openDeleteMessageModal({
      chatId: message.chatId,
      messageIds,
      isSchedule: messageListType === 'scheduled',
    });
  });

  const closePinModal = useLastCallback(() => {
    setIsPinModalOpen(false);
    onClose();
  });

  const handleReply = useLastCallback(() => {
    const quoteText = !message.isEphemeral && !message.content.richMessage
      && selectionQuoteOffset !== UNQUOTABLE_OFFSET && selectionRange
      ? getSelectionAsFormattedText(selectionRange) : undefined;
    const quoteRich = selectedRichQuote?.quoteRich;
    const quoteOffset = selectionQuoteOffset !== UNQUOTABLE_OFFSET ? selectionQuoteOffset : undefined;
    if (message.isEphemeral) {
      updateDraftReplyInfo({
        type: 'ephemeral',
        replyToMsgId: message.id,
      });
      closeMenu();
      return;
    }

    if (!canReplyInChat) {
      openReplyMenu({
        fromChatId: message.chatId, messageId: message.id, quoteText, quoteRich, quoteOffset,
      });
    } else {
      updateDraftReplyInfo({
        replyToMsgId: message.id,
        quoteText,
        quoteRich,
        quoteOffset,
        replyToPeerId: undefined,
      });
    }
    closeMenu();
  });

  const handleEdit = useLastCallback(() => {
    const messageId = message.isInAlbum ? selectAlbumMessageIdToEdit(getGlobal(), message) : message.id;
    startEditingMessage({ messageId });
    closeMenu();
  });

  const handlePin = useLastCallback(() => {
    setIsMenuOpen(false);
    setIsPinModalOpen(true);
  });

  const handleUnpin = useLastCallback(() => {
    pinMessage({ chatId: message.chatId, messageId: message.id, isUnpin: true });
    closeMenu();
  });

  const handleForward = useLastCallback(() => {
    closeMenu();
    if (album?.messages) {
      const messageIds = album.messages.map(({ id }) => id);
      openForwardMenu({ fromChatId: message.chatId, messageIds });
    } else {
      openForwardMenu({ fromChatId: message.chatId, messageIds: [message.id] });
    }
  });

  const handleCancelVote = useLastCallback(() => {
    closeMenu();
    cancelPollVote({ chatId: message.chatId, messageId: message.id });
  });

  const handlePollClose = useLastCallback(() => {
    closeMenu();
    closePoll({ chatId: message.chatId, messageId: message.id });
  });

  const handleSelectMessage = useLastCallback(() => {
    const params = album?.messages
      ? {
        messageId: message.id,
        childMessageIds: album.messages.map(({ id }) => id),
        withShift: false,
      }
      : { messageId: message.id, withShift: false };

    toggleMessageSelection(params);
    closeMenu();
  });

  const handleScheduledMessageSend = useLastCallback(() => {
    sendScheduledMessages({ chatId: message.chatId, id: message.id });
    closeMenu();
  });

  const handleRescheduleMessage = useLastCallback((
    scheduledAt: number,
  ) => {
    rescheduleMessage({
      chatId: message.chatId,
      messageId: message.id,
      scheduledAt,
    });
    onClose();
  });

  const handleOpenCalendar = useLastCallback(() => {
    setIsMenuOpen(false);
    requestCalendar(handleRescheduleMessage);
  });

  const handleOpenSeenByModal = useLastCallback(() => {
    closeMenu();
    openSeenByModal({ chatId: message.chatId, messageId: message.id });
  });

  const handleOpenMessageDetails = useLastCallback(() => {
    closeMenu();
    openMessageDetailsModal({ chatId: message.chatId, messageId: message.id });
  });

  const handleResend = useLastCallback(() => {
    closeMenu();
    resendMessage({ chatId: message.chatId, messageId: message.id });
  });

  const handleOpenReactorListModal = useLastCallback(() => {
    closeMenu();
    openReactorListModal({ chatId: message.chatId, messageId: message.id });
  });

  const handleCopyMessages = useLastCallback((request: MessageCopyRequest, textFormat?: ClipboardTextFormat) => {
    copyMessagesByIds({ request, shouldNotify: true, textFormat });
    closeMenu();
  });

  const handleCopyNumber = useLastCallback(() => {
    copyTextToClipboard(message.content.contact!.phoneNumber);
    closeMenu();
  });

  const handleDownloadClick = useLastCallback(() => {
    const global = getGlobal();
    (album?.messages || [message]).forEach((msg) => {
      const downloadableMedia = selectMessageDownloadableMedia(global, msg);
      if (!downloadableMedia) return;

      if (isDownloading) {
        cancelMediaDownload({ media: downloadableMedia });
      } else {
        downloadMedia({ media: downloadableMedia, originMessage: msg });
      }
    });
    closeMenu();
  });

  const handleOpenSavedFile = useLastCallback(() => {
    openSavedFile({ key: savedFileKey! });
    closeMenu();
  });

  const handleShowSavedFileInFolder = useLastCallback(() => {
    showSavedFileInFolder({ key: savedFileKey! });
    closeMenu();
  });

  const handleToggleMusicInProfile = useLastCallback(() => {
    toggleMusicInProfile({ audio: audio! });
    closeMenu();
  });

  const handleToggleReaction = useLastCallback((reaction: ApiReaction) => {
    toggleReaction({
      chatId: message.chatId, messageId: message.id, reaction, shouldAddToRecent: true,
    });
    closeMenu();
  });

  const handleReactionPickerOpen = useLastCallback((position: IAnchorPosition) => {
    openMessageReactionPicker({ chatId: message.chatId, messageId: message.id, position });
  });

  if (noOptions) {
    closeMenu();

    return undefined;
  }

  return (
    <div ref={containerRef} className={buildClassName('ContextMenuContainer', className)}>
      <MessageContextMenu
        isReactionPickerOpen={isReactionPickerOpen}
        availableReactions={availableReactions}
        topReactions={topReactions}
        defaultTagReactions={defaultTagReactions}
        message={message}
        threadId={threadId}
        messageListType={messageListType}
        isPrivate={isPrivate}
        isOpen={isMenuOpen}
        enabledReactions={enabledReactions}
        reactionsLimit={reactionsLimit}
        anchor={anchor}
        targetHref={targetHref}
        chat={chat}
        canShowReactionsCount={canShowReactionsCount}
        canShowReactionList={canShowReactionList}
        canSendNow={canSendNow}
        canReschedule={canReschedule}
        canReply={canReply}
        canQuote={selectionQuoteOffset !== UNQUOTABLE_OFFSET}
        canDelete={canDelete}
        canPin={canPin}
        canUnpin={canUnpin}
        canEdit={canEdit}
        canForward={canForward}
        canCopy={canCopy}
        canSelect={canSelect}
        canDownload={canDownload}
        canOpenSavedFile={Boolean(savedFileKey)}
        canManageMusicInProfile={canManageMusicInProfile}
        isMusicProfileStatusLoaded={isMusicProfileStatusLoaded}
        isMusicProfileActionLoading={isSavedMusicLoading}
        isMusicSaved={isMusicSaved}
        canRevote={canRevote}
        canClosePoll={canClosePoll}
        canShowSeenBy={canShowSeenBy}
        canViewDetails={canViewDetails}
        canResend={canResend}
        canPlayAnimatedEmojis={canPlayAnimatedEmojis}
        shouldRenderShowWhen={shouldRenderShowWhen}
        canLoadReadDate={canLoadReadDate}
        hasCustomEmoji={hasCustomEmoji}
        customEmojiSets={customEmojiSets}
        isDownloading={isDownloading}
        seenByRecentPeers={seenByRecentPeers}
        isInSavedMessages={isInSavedMessages}
        poll={poll}
        webPage={webPage}
        story={story}
        onReply={handleReply}
        onEdit={handleEdit}
        onPin={handlePin}
        onUnpin={handleUnpin}
        onForward={handleForward}
        onDelete={handleDelete}
        onSelect={handleSelectMessage}
        onSend={handleScheduledMessageSend}
        onReschedule={handleOpenCalendar}
        onClose={closeMenu}
        onCopyMessages={handleCopyMessages}
        onCopyNumber={handleCopyNumber}
        onDownload={handleDownloadClick}
        onOpenSavedFile={handleOpenSavedFile}
        onShowSavedFileInFolder={handleShowSavedFileInFolder}
        onToggleMusicInProfile={handleToggleMusicInProfile}
        onCancelVote={handleCancelVote}
        onClosePoll={openClosePollDialog}
        onShowSeenBy={handleOpenSeenByModal}
        onViewDetails={handleOpenMessageDetails}
        onResend={handleResend}
        onToggleReaction={handleToggleReaction}
        onShowReactors={handleOpenReactorListModal}
        onReactionPickerOpen={handleReactionPickerOpen}
        noForwardsNotice={noForwardsNotice}
      />
      <PinMessageModal
        isOpen={isPinModalOpen}
        messageId={message.id}
        chatId={message.chatId}
        onClose={closePinModal}
      />
      <ConfirmDialog
        isOpen={isClosePollDialogOpen}
        onClose={closeClosePollDialog}
        text={lang('PollsStopWarning')}
        confirmLabel={lang('PollsStopSure')}
        confirmHandler={handlePollClose}
      />
      {canReschedule && calendar}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, {
    message, album, messageListType, threadId,
  }): Complete<StateProps> => {
    const { defaultTags, topReactions, availableReactions } = global.reactions;

    const activeDownloads = selectActiveDownloads(global);
    // An album holds several files, so its menu has no actions for a saved one
    const downloadableMedia = album ? undefined : selectMessageDownloadableMedia(global, message);
    const mediaHash = downloadableMedia && getMediaHash(downloadableMedia, 'download');
    const savedFileKey = selectIsFileSaved(global, mediaHash) ? mediaHash : undefined;
    const chat = selectChat(global, message.chatId);
    const isPrivate = chat && isUserId(chat.id);
    const chatFullInfo = !isPrivate ? selectChatFullInfo(global, message.chatId) : undefined;
    const user = selectUser(global, message.chatId);
    const userFullInfo = isPrivate ? selectUserFullInfo(global, message.chatId) : undefined;

    const {
      seenByExpiresAt, seenByMaxChatMembers, maxUniqueReactions, readDateExpiresAt,
    } = global.appConfig;

    const reactionsLimit = maxUniqueReactions;

    const {
      noOptions,
      canReplyGlobally,
      canPin,
      canUnpin,
      canDelete,
      canEdit,
      canCopy,
      canSelect,
      canDownload,
      canRevote,
      canClosePoll,
      canViewDetails,
      canResend,
    } = (threadId && selectAllowedMessageActionsSlow(global, message, threadId)) || {};
    const canForward = selectCanForwardMessage(global, message);

    const userStatus = isPrivate ? selectUserStatus(global, chat.id) : undefined;
    const isOwn = isOwnMessage(message);
    const isMessageUnread = selectIsMessageUnread(
      global, message.chatId, threadId || MAIN_THREAD_ID, message.id, messageListType,
    );
    const canLoadReadDate = Boolean(
      isPrivate
      && isOwn
      && !isMessageUnread
      && readDateExpiresAt
      && message.date > Date.now() / 1000 - readDateExpiresAt
      && !userStatus?.isReadDateRestricted
      && messageListType !== 'scheduled',
    );
    const shouldRenderShowWhen = Boolean(
      canLoadReadDate && isPrivate && selectUserStatus(global, chat.id)?.isReadDateRestrictedByMe,
    );
    const isPinned = messageListType === 'pinned';
    const isScheduled = messageListType === 'scheduled';

    const canSendText = chat && !isUserRightBanned(chat, 'sendPlain');

    const canReplyInChat = chat && threadId ? getCanPostInChat(chat) && canSendText : false;

    const isLocal = isMessageLocal(message);
    const hasTtl = hasMessageTtl(message);
    const canShowSeenBy = Boolean(!isLocal
      && chat
      && !isMessageUnread
      && seenByMaxChatMembers
      && seenByExpiresAt
      && isChatGroup(chat)
      && isOwn
      && !isScheduled
      && chat.membersCount
      && chat.membersCount <= seenByMaxChatMembers
      && message.date > Date.now() / 1000 - seenByExpiresAt);
    const isAction = isActionMessage(message);
    const canShowReactionsCount = !isLocal && !isScheduled && !isAction && !isPrivate && message.reactions
      && !areReactionsEmpty(message.reactions) && message.reactions.canSeeList;
    const isProtected = selectIsMessageProtected(global, message);
    const canCopyNumber = Boolean(message.content.contact);

    const isInSavedMessages = selectIsChatWithSelf(global, message.chatId);

    const poll = selectPollFromMessage(global, message);
    const webPage = selectWebPageFromMessage(global, message);
    const storyData = message.content.storyData;
    const story = storyData ? selectPeerStory(global, storyData.peerId, storyData.id) : undefined;

    return {
      chat,
      availableReactions,
      topReactions,
      defaultTagReactions: defaultTags,
      noOptions: message.isEphemeral ? false : noOptions,
      canSendNow: isScheduled,
      canReschedule: isScheduled,
      canReply: message.isEphemeral
        ? getCanReplyToEphemeralMessage(message)
        : !isPinned && !isScheduled && canReplyGlobally,
      canPin: !message.isEphemeral && !isScheduled && canPin,
      canUnpin: !message.isEphemeral && !isScheduled && canUnpin,
      canDelete: message.isEphemeral || canDelete,
      canEdit: !message.isEphemeral && !isPinned && canEdit,
      canForward: !isScheduled && canForward,
      canCopy: (canCopyNumber || (!isProtected && canCopy)),
      isMessageProtected: isProtected,
      canSelect: !message.isEphemeral && canSelect,
      canDownload: !isProtected && canDownload,
      canRevote: !message.isEphemeral && canRevote,
      canClosePoll: !message.isEphemeral && !isScheduled && canClosePoll,
      canViewDetails: !message.isEphemeral && !isScheduled && canViewDetails,
      canResend: !message.isEphemeral && !isScheduled && canResend,
      activeDownloads,
      savedFileKey,
      canShowSeenBy: !message.isEphemeral && canShowSeenBy,
      canLoadReadDate: !message.isEphemeral && canLoadReadDate,
      shouldRenderShowWhen: !message.isEphemeral && shouldRenderShowWhen,
      enabledReactions: message.isEphemeral || chat?.isForbidden ? undefined : chatFullInfo?.enabledReactions,
      reactionsLimit,
      isPrivate,
      hasFullInfo: Boolean(chatFullInfo),
      canShowReactionsCount: !message.isEphemeral && canShowReactionsCount,
      canShowReactionList: !message.isEphemeral && !isLocal && !isAction && !isScheduled && !hasTtl
        && !(chat && !isPrivate && !isChatAdmin(chat) && isUserRightBanned(chat, 'sendReactions')),
      canScheduleUntilOnline: selectCanScheduleUntilOnline(global, message.chatId),
      canPlayAnimatedEmojis: !message.isEphemeral && selectCanPlayAnimatedEmojis(global),
      isReactionPickerOpen: !message.isEphemeral && selectIsReactionPickerOpen(global),
      isInSavedMessages,
      quoteLengthMax: global.appConfig.quoteLengthMax,
      canReplyInChat,
      poll,
      story,
      user,
      webPage,
      noForwardsMyEnabled: userFullInfo?.noForwardsMyEnabled,
      noForwardsPeerEnabled: userFullInfo?.noForwardsPeerEnabled,
      savedMusicById: global.users.savedMusicById,
      isSavedMusicLoading: global.users.isSavedMusicLoading,
    };
  },
)(ContextMenuContainer));
