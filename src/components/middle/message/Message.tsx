import {
  type ElementRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useUnmountCleanup,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type {
  ApiAvailableReaction,
  ApiChat,
  ApiChatMember,
  ApiMessage,
  ApiMessageOutgoingStatus,
  ApiMessagePoll,
  ApiPeer,
  ApiReaction,
  ApiReactionKey,
  ApiSavedReactionTag,
  ApiThreadInfo,
  ApiTypeStory,
  ApiUser,
  ApiWebPage,
} from '../../../api/types';
import type { ObserveFn } from '../../../hooks/useIntersectionObserver';
import type {
  ActiveEmojiInteraction,
  FocusDirection,
  IAlbum,
  IDocumentGroup,
  MessageListType,
  ScrollTargetPosition,
  ThemeKey,
  ThreadId,
} from '../../../types';
import type { Signal } from '../../../util/signals';
import { MAIN_THREAD_ID } from '../../../api/types';

import { EMOJI_STATUS_LOOP_LIMIT, MESSAGE_APPEARANCE_DELAY } from '../../../config';
import {
  areReactionsEmpty,
  extractMessageText,
  getAllowedAttachmentOptions,
  getCanReplyToEphemeralMessage,
  getIsDownloading,
  getMainUsername,
  getMessageContent,
  getMessageCustomShape,
  getMessageHtmlId,
  getMessageSingleCustomEmoji,
  getMessageSingleRegularEmoji,
  getMessageWebPage,
  getSendErrorKey,
  hasMessageText,
  hasMessageTtl,
  isAnonymousOwnMessage,
  isChatChannel,
  isChatGroup,
  isChatPublic,
  isMessageLocal,
  isMessageLocalOnly,
  isMessageUnsupported,
  isOwnMessage,
  isReplyToMessage,
} from '../../../global/helpers';
import { getPeerFullTitle } from '../../../global/helpers/peers';
import { getEphemeralReplyInfo, getMessageReplyInfo, getStoryReplyInfo } from '../../../global/helpers/replies';
import {
  selectActiveDownloads,
  selectAnimatedEmoji,
  selectCanAutoLoadMedia,
  selectCanAutoPlayMedia,
  selectCanForwardMessage,
  selectCanReplyToMessage,
  selectChat,
  selectChatFullInfo,
  selectChatMessage,
  selectCurrentMiddleSearch,
  selectDefaultReaction,
  selectEphemeralOutgoingStatus,
  selectForwardedSender,
  selectFullWebPageFromMessage,
  selectIsChatRestricted,
  selectIsChatWithSelf,
  selectIsCurrentUserFrozen,
  selectIsDocumentGroupSelected,
  selectIsInSelectMode,
  selectIsMessageFocused,
  selectIsMessageProtected,
  selectIsMessageSelected,
  selectOutgoingStatus,
  selectPeer,
  selectPeerStory,
  selectPerformanceSettingsValue,
  selectPollFromMessage,
  selectReplyMessage,
  selectSender,
  selectSenderFromHeader,
  selectShouldLoopStickers,
  selectTabState,
  selectTheme,
  selectUploadProgress,
  selectUser,
} from '../../../global/selectors';
import {
  selectIsMediaNsfw,
  selectMessageDownloadableMedia,
  selectMessageLastPlaybackTimestamp,
  selectMessageTimestampableDuration,
} from '../../../global/selectors/media';
import { selectSharedSettings } from '../../../global/selectors/sharedState';
import { selectThreadInfo, selectThreadReadState } from '../../../global/selectors/threads';
import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import { IS_ANDROID } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';
import buildStyle from '../../../util/buildStyle';
import { isUserId } from '../../../util/entities/ids';
import { getMessageKey } from '../../../util/keys/messageKey';
import stopEvent from '../../../util/stopEvent';
import { getRichQuoteTexts } from '../../../util/text/richQuote';
import { isElementInViewport } from '../../../util/visibility/isElementInViewport';
import { getStickerDimensions, REM } from '../../common/helpers/mediaDimensions';
import renderText from '../../common/helpers/renderText';
import { getCustomEmojiSize } from '../composer/helpers/customEmoji';
import { buildContentClassName } from './helpers/buildContentClassName';

import useAppLayout from '../../../hooks/useAppLayout';
import useContextMenuHandlers from '../../../hooks/useContextMenuHandlers';
import useEnsureMessage from '../../../hooks/useEnsureMessage';
import useEnsureStory from '../../../hooks/useEnsureStory';
import useFlag from '../../../hooks/useFlag';
import { useOnIntersect } from '../../../hooks/useIntersectionObserver';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import usePeerColor from '../../../hooks/usePeerColor';
import useShowTransition from '../../../hooks/useShowTransition';
import useTextHighlight from '../../../hooks/useTextHighlight';
import useFocusMessageListElement from './hooks/useFocusMessageListElement';
import useInnerHandlers from './hooks/useInnerHandlers';
import useMessageReadMetrics from './hooks/useMessageReadMetrics';
import useOuterHandlers from './hooks/useOuterHandlers';

import Audio from '../../common/Audio';
import Avatar from '../../common/Avatar';
import BadgeButton from '../../common/BadgeButton';
import CustomEmoji from '../../common/CustomEmoji';
import Document from '../../common/Document';
import EmbeddedMessage from '../../common/embedded/EmbeddedMessage';
import EmbeddedStory from '../../common/embedded/EmbeddedStory';
import FakeIcon from '../../common/FakeIcon';
import Icon from '../../common/icons/Icon';
import MessageRichText from '../../common/MessageRichText';
import MessageText from '../../common/MessageText';
import RankBadge from '../../common/RankBadge';
import ReactionStaticEmoji from '../../common/reactions/ReactionStaticEmoji';
import UnsupportedPlate from '../../common/UnsupportedPlate';
import Button from '../../ui/Button';
import Album from './Album';
import AnimatedCustomEmoji from './AnimatedCustomEmoji';
import AnimatedEmoji from './AnimatedEmoji';
import CommentButton from './CommentButton';
import Contact from './Contact';
import ContextMenuContainer from './ContextMenuContainer.async';
import DiceWrapper from './dice/DiceWrapper';
import FactCheck from './FactCheck';
import MessageAppendix from './MessageAppendix';
import MessageMeta from './MessageMeta';
import MessagePhoneCall from './MessagePhoneCall';
import Photo from './Photo';
import Poll from './poll/Poll';
import Reactions from './reactions/Reactions';
import RoundVideo from './RoundVideo';
import Sticker from './Sticker';
import Story from './Story';
import StoryMention from './StoryMention';
import Video from './Video';
import WebPage from './WebPage';

import './Message.scss';

type MessagePositionProperties = {
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  isFirstInDocumentGroup: boolean;
  isLastInDocumentGroup: boolean;
  isLastInList: boolean;
};

type OwnProps = {
  message: ApiMessage;
  album?: IAlbum;
  documentGroup?: IDocumentGroup;
  noAvatars?: boolean;
  withAvatar?: boolean;
  withSenderName?: boolean;
  threadId: ThreadId;
  messageListType: MessageListType;
  noComments: boolean;
  noReplies: boolean;
  appearanceOrder: number;
  isJustAdded: boolean;
  isThreadTop?: boolean;
  shouldIgnoreSendFocus?: boolean;
  isQuickPreview?: boolean;
  memoFirstUnreadIdRef?: { current: number | undefined };
  getIsMessageListReady?: Signal<boolean>;
  containerRef?: ElementRef<HTMLDivElement>;
  isMessageListActive?: boolean;
  observeIntersectionForBottom?: ObserveFn;
  observeIntersectionForLoading?: ObserveFn;
  observeIntersectionForPlaying?: ObserveFn;
  onMessageUnmount?: (messageId: number) => void;
} & MessagePositionProperties;

type StateProps = {
  theme: ThemeKey;
  forceSenderName?: boolean;
  sender?: ApiPeer;
  canShowSender: boolean;
  originSender?: ApiPeer;
  ephemeralBot?: ApiUser;
  shouldHideReply?: boolean;
  replyMessage?: ApiMessage;
  replyMessageSender?: ApiPeer;
  replyMessageForwardSender?: ApiPeer;
  replyMessageChat?: ApiChat;
  isReplyPrivate?: boolean;
  replyStory?: ApiTypeStory;
  storySender?: ApiPeer;
  outgoingStatus?: ApiMessageOutgoingStatus;
  uploadProgress?: number;
  isInDocumentGroup: boolean;
  isProtected?: boolean;
  canForward?: boolean;
  isFocused?: boolean;
  focusDirection?: FocusDirection;
  focusedQuote?: string;
  focusedQuoteOffset?: number;
  focusedPollOption?: string;
  noFocusHighlight?: boolean;
  scrollTargetPosition?: ScrollTargetPosition;
  isResizingContainer?: boolean;
  isForwarding?: boolean;
  isChatWithSelf?: boolean;
  isChannel?: boolean;
  isGroup?: boolean;
  canReply?: boolean;
  highlight?: string;
  animatedEmoji?: string;
  animatedCustomEmoji?: string;
  hasActiveReactions?: boolean;
  isInSelectMode?: boolean;
  isSelected?: boolean;
  isGroupSelected?: boolean;
  isDownloading?: boolean;
  threadId?: ThreadId;
  isPinnedList?: boolean;
  isPinned?: boolean;
  isMessagePrimaryEditedDateEnabled: boolean;
  canAutoLoadMedia?: boolean;
  canAutoPlayMedia?: boolean;
  hasLinkedChat?: boolean;
  shouldLoopStickers?: boolean;
  autoLoadFileMaxSizeMb: number;
  repliesThreadInfo?: ApiThreadInfo;
  reactionMessage?: ApiMessage;
  availableReactions?: ApiAvailableReaction[];
  defaultReaction?: ApiReaction;
  activeEmojiInteractions?: ActiveEmojiInteraction[];
  hasUnreadReaction?: boolean;
  hasUnreadPollVote?: boolean;
  senderChatMember?: ApiChatMember;
  withAnimatedEffects?: boolean;
  canAnimateTextStreaming?: boolean;
  webPageStory?: ApiTypeStory;
  isConnected: boolean;
  isLoadingComments?: boolean;
  shouldWarnAboutFiles?: boolean;
  tags?: Record<ApiReactionKey, ApiSavedReactionTag>;
  poll?: ApiMessagePoll;
  webPage?: ApiWebPage;
  maxTimestamp?: number;
  lastPlaybackTimestamp?: number;
  isChatWithUser?: boolean;
  isAccountFrozen?: boolean;
  isMediaNsfw?: boolean;
  isReplyMediaNsfw?: boolean;
  canSendStickers?: boolean;
};

type MetaPosition =
  'in-text'
  | 'standalone'
  | 'none';
type ReactionsPosition =
  'inside'
  | 'outside'
  | 'none';
type QuickReactionPosition =
  'in-content'
  | 'in-meta';

const NBSP = '\u00A0';
const QUICK_REACTION_SIZE = 1.75 * REM;
const MIN_MESSAGE_LENGTH_FOR_WIDE_MEDIA = 40;

const Message = ({
  message,
  album,
  noAvatars,
  withAvatar,
  withSenderName,
  noComments,
  noReplies,
  appearanceOrder,
  isJustAdded,
  isFirstInGroup,
  isLastInGroup,
  isFirstInDocumentGroup,
  isLastInDocumentGroup,
  isLastInList,
  theme,
  forceSenderName,
  sender,
  canShowSender,
  originSender,
  ephemeralBot,
  isThreadTop,
  shouldHideReply,
  replyMessage,
  replyMessageSender,
  replyMessageForwardSender,
  replyMessageChat,
  replyStory,
  isReplyPrivate,
  storySender,
  outgoingStatus,
  uploadProgress,
  isInDocumentGroup,
  isLoadingComments,
  isProtected,
  canForward,
  isFocused,
  focusDirection,
  focusedQuote,
  focusedQuoteOffset,
  focusedPollOption,
  noFocusHighlight,
  scrollTargetPosition,
  isResizingContainer,
  isForwarding,
  isChatWithSelf,
  isChannel,
  isGroup,
  canReply,
  highlight,
  animatedEmoji,
  animatedCustomEmoji,
  hasActiveReactions,
  hasLinkedChat,
  isInSelectMode,
  isSelected,
  isGroupSelected,
  threadId,
  reactionMessage,
  availableReactions,
  defaultReaction,
  activeEmojiInteractions,
  messageListType,
  isPinnedList,
  isPinned,
  isMessagePrimaryEditedDateEnabled,
  isDownloading,
  canAutoLoadMedia,
  canAutoPlayMedia,
  shouldLoopStickers,
  autoLoadFileMaxSizeMb,
  repliesThreadInfo,
  hasUnreadReaction,
  hasUnreadPollVote,
  memoFirstUnreadIdRef,
  senderChatMember,
  withAnimatedEffects,
  canAnimateTextStreaming,
  webPageStory,
  isConnected,
  getIsMessageListReady,
  containerRef,
  shouldWarnAboutFiles,
  tags,
  poll,
  maxTimestamp,
  lastPlaybackTimestamp,
  isMediaNsfw,
  isReplyMediaNsfw,
  isChatWithUser,
  isAccountFrozen,
  webPage,
  canSendStickers,
  observeIntersectionForBottom,
  observeIntersectionForLoading,
  observeIntersectionForPlaying,
  isMessageListActive,
  isQuickPreview,
  onMessageUnmount,
}: OwnProps & StateProps) => {
  const {
    toggleMessageSelection,
    disableContextMenuHint,
    animateUnreadReaction,
    markTypingDraftDone,
    markMessageListRead,
    markMentionsRead,
    markPollVotesRead,
    openMessageDetailsModal,
    showNotification,
  } = getActions();

  const ref = useRef<HTMLDivElement>();
  const bottomMarkerRef = useRef<HTMLDivElement>();
  const quickReactionRef = useRef<HTMLDivElement>();

  const lang = useLang();
  const {
    id: messageId, chatId, forwardInfo, factCheck,
    isTypingDraft, previousLocalId, fromRank,
  } = message;

  const isLocalOnly = isMessageLocalOnly(message);

  const [isPlayingDeleteAnimation, setIsPlayingDeleteAnimation] = useState(false);
  const [shouldPlayEffect, requestEffect, hideEffect] = useFlag();
  const [shouldPlayDiceEffect, requestDiceEffect, hideDiceEffect] = useFlag();
  const { isMobile, isTouchScreen } = useAppLayout();

  useOnIntersect(bottomMarkerRef, isTypingDraft || isLocalOnly ? undefined : observeIntersectionForBottom);

  const {
    isContextMenuOpen,
    contextMenuAnchor,
    contextMenuTarget,
    handleBeforeContextMenu,
    handleContextMenu: onContextMenu,
    handleContextMenuClose,
    handleContextMenuHide,
  } = useContextMenuHandlers(
    ref,
    (isTouchScreen && isInSelectMode) || isAccountFrozen,
    !IS_TAURI,
    IS_ANDROID,
    getIsMessageListReady,
  );

  useEffect(() => {
    if (isContextMenuOpen) {
      disableContextMenuHint();
    }
  }, [isContextMenuOpen, disableContextMenuHint]);

  const noAppearanceAnimation = appearanceOrder <= 0 || message.shouldSkipTypingAnimation;
  const [isShown, markShown] = useFlag(noAppearanceAnimation);
  useEffect(() => {
    if (noAppearanceAnimation) {
      return;
    }

    // Message appearance animation works only if this timeout is not cleared. Migrate to `sibling-index()` when baseline widely available.
    setTimeout(markShown, appearanceOrder * MESSAGE_APPEARANCE_DELAY);
  }, [appearanceOrder, noAppearanceAnimation]);

  useShowTransition({
    ref,
    isOpen: isShown || isJustAdded,
    noMountTransition: message.shouldSkipTypingAnimation || (noAppearanceAnimation && !isJustAdded),
    className: false,
  });

  useUnmountCleanup(() => {
    onMessageUnmount?.(messageId);
  });

  const isLocal = isMessageLocal(message);
  const isOwn = isOwnMessage(message);
  const isScheduled = messageListType === 'scheduled' || message.isScheduled;
  const messageReplyInfo = getMessageReplyInfo(message) || getEphemeralReplyInfo(message);
  const isEphemeralReply = messageReplyInfo?.type === 'ephemeral';
  const storyReplyInfo = getStoryReplyInfo(message);
  const readMetricsMessage = album?.mainMessage || message;
  const canReportReadMetrics = messageListType === 'thread'
    && threadId === MAIN_THREAD_ID
    && !isQuickPreview
    && !isLocal
    && !isLocalOnly
    && readMetricsMessage.viewsCount !== undefined;
  const hasMessageReply = isReplyToMessage(message) && !shouldHideReply
    && (!isEphemeralReply || Boolean(replyMessage))
    && (!isInDocumentGroup || isFirstInDocumentGroup);

  useMessageReadMetrics({
    messageRef: ref,
    containerRef,
    chatId,
    messageId: readMetricsMessage.id,
    isEnabled: canReportReadMetrics,
    isMessageListActive,
  });

  const {
    photo, video, audio,
    voice, document, sticker, contact,
    action, storyData, dice,
  } = getMessageContent(message);

  const hasStoryReply = Boolean(storyReplyInfo);
  const hasThread = Boolean(repliesThreadInfo) && messageListType === 'thread';
  const isUnsupported = isMessageUnsupported(message);
  const isCustomShape = getMessageCustomShape(message);
  const hasAnimatedEmoji = isCustomShape && (animatedEmoji || animatedCustomEmoji);
  const hasReactions = reactionMessage?.reactions && !areReactionsEmpty(reactionMessage.reactions);

  const asForwarded = (
    forwardInfo
    && (!isChatWithSelf || isScheduled)
    && !forwardInfo.isLinkedChannelPost
  ) || Boolean(storyData && !storyData.isMention);
  const isStoryMention = storyData?.isMention;
  const isRoundVideo = video?.mediaType === 'video' && video.isRound;
  const isAlbum = Boolean(album)
    && (album.isSingleMessage || album.messages.length > 1)
    && !album.messages.some((msg) => Object.keys(msg.content).length === 0);
  const isInDocumentGroupNotFirst = isInDocumentGroup && !isFirstInDocumentGroup;
  const isInDocumentGroupNotLast = isInDocumentGroup && !isLastInDocumentGroup;
  const isContextMenuShown = contextMenuAnchor !== undefined;
  const canShowActionButton = (
    !(isContextMenuShown || isInSelectMode || isForwarding)
    && !isInDocumentGroupNotLast
    && !isStoryMention
  );
  const canFocus = Boolean(isPinnedList
    || (forwardInfo
      && (forwardInfo.isChannelPost || isChatWithSelf)
      && forwardInfo.fromMessageId
    ));

  const hasFactCheck = Boolean(factCheck?.text);

  const hasForwardedCustomShape = asForwarded && isCustomShape;
  const hasSubheader = message.isEphemeral
    || hasMessageReply || hasStoryReply || hasForwardedCustomShape;

  const selectMessage = useLastCallback((e?: React.MouseEvent<HTMLDivElement, MouseEvent>, groupedId?: string) => {
    if (isAccountFrozen || message.isEphemeral) return;
    toggleMessageSelection({
      messageId,
      groupedId,
      ...(e?.shiftKey && { withShift: true }),
      ...(isAlbum && { childMessageIds: album.messages.map(({ id }) => id) }),
    });
  });

  const messageSender = canShowSender ? sender : undefined;

  const shouldPreferOriginSender = forwardInfo
    && (isChatWithSelf || !messageSender);
  const avatarPeer = shouldPreferOriginSender ? originSender : messageSender;

  const messageColorPeer = asForwarded ? originSender : sender;
  const noUserColors = isOwn && !isCustomShape;

  const senderPeer = (forwardInfo || storyData) ? originSender : messageSender;
  const hasTtl = hasMessageTtl(message);

  const {
    handleMouseDown,
    handleClick,
    handleContextMenu,
    handleDoubleClick,
    handleContentDoubleClick,
    handleMouseMove,
    handleSendQuickReaction,
    handleMouseLeave,
    isSwiped,
    isQuickReactionVisible,
    handleDocumentGroupMouseEnter,
  } = useOuterHandlers(
    selectMessage,
    ref,
    messageId,
    Boolean(isInSelectMode),
    Boolean(canReply),
    Boolean(isProtected),
    onContextMenu,
    handleBeforeContextMenu,
    chatId,
    isContextMenuShown,
    quickReactionRef,
    isInDocumentGroupNotLast,
    getIsMessageListReady,
    message.isEphemeral,
  );

  const {
    handleSenderClick,
    handleReplyClick,
    handleMediaClick,
    handleDocumentClick,
    handleAudioPlay,
    handleAlbumMediaClick,
    handlePhotoMediaClick,
    handleVideoMediaClick,
    handleMetaClick,
    handleOpenThread,
    handleReadMedia,
    handleCancelUpload,
    handleGroupForward,
    handleForward,
    handleFocus,
    handleFocusForwarded,
    handleDocumentGroupSelectAll,
    handleStoryClick,
  } = useInnerHandlers({
    selectMessage,
    message,
    webPage,
    chatId,
    threadId,
    isInDocumentGroup,
    asForwarded,
    isScheduled,
    album,
    avatarPeer,
    senderPeer,
    story: replyStory && 'content' in replyStory ? replyStory : undefined,
    isReplyPrivate,
    isSavedMessages: isChatWithSelf,
    lastPlaybackTimestamp,
  });

  useEffect(() => {
    const isPartialAlbumDelete = message.isInAlbum && album?.messages.some((msg) => !msg.isDeleting);
    if (isPartialAlbumDelete) return;

    if (!message.isDeleting) {
      setIsPlayingDeleteAnimation(false);
      return;
    }

    setIsPlayingDeleteAnimation(true);
  // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps -- Synchronize animation on `isDeleting` changes
  }, [message.isDeleting]);

  const textMessage = album?.hasMultipleCaptions ? undefined : (album?.captionMessage || message);
  const hasTextContent = textMessage && hasMessageText(textMessage);
  const hasText = hasTextContent || hasFactCheck;

  const containerClassName = buildClassName(
    'Message message-list-item',
    isFirstInGroup && 'first-in-group',
    isProtected && 'hide-on-print',
    isProtected ? 'is-protected' : 'allow-selection',
    isLastInGroup && 'last-in-group',
    isFirstInDocumentGroup && 'first-in-document-group',
    isLastInDocumentGroup && 'last-in-document-group',
    isLastInList && 'last-in-list',
    isOwn && 'own',
    Boolean(message.viewsCount) && 'has-views',
    message.isEdited && 'was-edited',
    hasMessageReply && 'has-reply',
    isContextMenuOpen && 'has-menu-open',
    isFocused && !noFocusHighlight && 'focused',
    isForwarding && 'is-forwarding',
    isPlayingDeleteAnimation && 'is-deleting',
    isInDocumentGroup && 'is-in-document-group',
    isAlbum && 'is-album',
    message.hasUnreadMention && 'has-unread-mention',
    isSelected && 'is-selected',
    isInSelectMode && 'is-in-selection-mode',
    isThreadTop && !withAvatar && 'is-thread-top',
    isSwiped && 'is-swiped',
    isJustAdded && 'is-just-added',
    (hasActiveReactions || shouldPlayEffect) && 'has-active-effect',
    isStoryMention && 'is-story-mention',
  );

  const text = textMessage && getMessageContent(textMessage).text;
  // Unsupported media can keep the flag, but its plate has no caption to put above it
  const isInvertedMedia = Boolean(message.isInvertedMedia) && !isUnsupported;

  const replyToMsgId = messageReplyInfo?.replyToMsgId;
  const replyToPeerId = messageReplyInfo?.type === 'message' ? messageReplyInfo.replyToPeerId : undefined;
  const { peerId: storyReplyPeerId, storyId: storyReplyId } = storyReplyInfo || {};

  useEffect(() => {
    if (sticker?.hasEffect && ((
      memoFirstUnreadIdRef?.current && messageId >= memoFirstUnreadIdRef.current
    ) || isLocal)) {
      requestEffect();
    }
  }, [isLocal, memoFirstUnreadIdRef, messageId, sticker?.hasEffect]);

  useEffect(() => {
    if (dice && ((
      memoFirstUnreadIdRef?.current && messageId >= memoFirstUnreadIdRef.current
    ) || isLocal)) {
      requestDiceEffect();
    }
  }, [dice, memoFirstUnreadIdRef, messageId, isLocal]);

  const textForLanguageDetection = useMemo(() => textMessage && extractMessageText(textMessage)?.text, [textMessage]);
  const quoteToHighlight = focusedQuote;
  const textRef = useRef<HTMLDivElement>();
  const richMessage = textMessage?.content.richMessage;
  const shouldHighlight = Boolean(highlight || quoteToHighlight);
  const richQuoteTexts = useMemo(
    () => shouldHighlight && richMessage ? getRichQuoteTexts(richMessage.blocks) : undefined,
    [richMessage, shouldHighlight],
  );
  const quoteSelector = focusedPollOption !== undefined ? `[data-poll-option="${btoa(focusedPollOption)}"]` : undefined;
  const highlightedText = textForLanguageDetection;
  useTextHighlight(textRef, { text: highlightedText, richTexts: richQuoteTexts, search: highlight });
  const getQuoteRange = useTextHighlight(quoteSelector ? ref : textRef, {
    text: highlightedText,
    richTexts: richQuoteTexts,
    quote: quoteToHighlight,
    quoteOffset: focusedQuoteOffset,
    quoteSelector,
  });

  const phoneCall = action?.type === 'phoneCall' ? action : undefined;

  const commentsThreadInfo = repliesThreadInfo?.isCommentsInfo ? repliesThreadInfo : undefined;
  const isLocalWithCommentButton = hasLinkedChat && isChannel && isLocal;

  const isMediaWithCommentButton = (commentsThreadInfo || isLocalWithCommentButton)
    && !isInDocumentGroupNotLast
    && messageListType === 'thread'
    && !noComments;
  const withCommentButton = (commentsThreadInfo || isLocalWithCommentButton)
    && !isInDocumentGroupNotLast && messageListType === 'thread'
    && !noComments;
  const withQuickReactionButton = !message.isEphemeral
    && !isTouchScreen && !phoneCall && !isInSelectMode && defaultReaction
    && !isInDocumentGroupNotLast && !isStoryMention && !hasTtl && !isAccountFrozen;

  const hasOutsideReactions = hasReactions
    && (isCustomShape || (
      (photo || video || storyData) && (!hasText || isInvertedMedia))
    );

  const { className: peerColorClass, style: peerColorStyle } = usePeerColor({
    peer: messageColorPeer,
    noUserColors,
    shouldReset: true,
  });

  const hasWideMedia = Boolean(
    (photo || video || isAlbum)
    && ((text?.text.length || 0) > MIN_MESSAGE_LENGTH_FOR_WIDE_MEDIA || isMediaWithCommentButton),
  );
  const contentClassName = buildClassName(buildContentClassName(message, album, {
    poll,
    webPage,
    hasSubheader,
    isCustomShape,
    isLastInGroup,
    asForwarded,
    hasThread: hasThread && !noComments,
    forceSenderName,
    hasCommentCounter: hasThread && repliesThreadInfo.messagesCount !== undefined
      && repliesThreadInfo.messagesCount > 0,
    hasBottomCommentButton: withCommentButton && !isCustomShape,
    hasActionButton: canForward || canFocus || (withCommentButton && isCustomShape),
    hasReactions,
    peerColorClass,
    hasOutsideReactions,
  }), hasWideMedia && 'with-wide-media');

  const withAppendix = contentClassName.includes('has-appendix');
  const emojiSize = getCustomEmojiSize(text?.emojiOnlyCount);

  let metaPosition!: MetaPosition;
  if (phoneCall) {
    metaPosition = 'none';
  } else if (isInDocumentGroupNotLast) {
    metaPosition = 'none';
  } else if (isUnsupported) {
    // The plate replaces the text, so the meta stands over its corner, as on a sticker
    metaPosition = 'standalone';
  } else if (hasText && !webPage && !emojiSize && !isInvertedMedia) {
    metaPosition = 'in-text';
  } else if (isInvertedMedia && !emojiSize && (hasFactCheck || webPage)) {
    metaPosition = 'in-text';
  } else {
    metaPosition = 'standalone';
  }

  let reactionsPosition!: ReactionsPosition;
  if (hasReactions) {
    if (hasOutsideReactions) {
      reactionsPosition = 'outside';
    } else if (asForwarded) {
      metaPosition = 'standalone';
      reactionsPosition = 'inside';
    } else {
      reactionsPosition = 'inside';
    }
  } else {
    reactionsPosition = 'none';
  }

  const quickReactionPosition: QuickReactionPosition = isCustomShape ? 'in-meta' : 'in-content';

  useEnsureMessage(
    replyToPeerId || chatId,
    replyToMsgId,
    replyMessage,
    message.id,
    shouldHideReply || isReplyPrivate || isEphemeralReply,
  );

  useEnsureStory(
    storyReplyPeerId || chatId,
    storyReplyId,
    replyStory,
  );

  useFocusMessageListElement({
    elementRef: ref,
    isFocused,
    focusDirection,
    noFocusHighlight,
    isResizingContainer,
    isJustAdded,
    isQuotePending: Boolean(quoteToHighlight && richMessage?.isPart),
    getQuoteRange,
    scrollTargetPosition,
  });

  const canShowPostAuthor = !message.senderId;
  const signature = (canShowPostAuthor && message.postAuthorTitle)
    || ((asForwarded || isChatWithSelf) && forwardInfo?.postAuthorTitle)
    || undefined;

  useEffect(() => {
    if (isTypingDraft || isLocalOnly) {
      return;
    }

    const bottomMarker = bottomMarkerRef.current;
    if (!bottomMarker || !isElementInViewport(bottomMarker)) return;

    if (
      message.wasTypingDraft
      && !isQuickPreview
      && !isOwn
      && memoFirstUnreadIdRef?.current
      && messageId >= memoFirstUnreadIdRef.current
    ) {
      markMessageListRead({ maxId: messageId });
    }

    if (hasUnreadReaction) {
      animateUnreadReaction({ chatId, messageIds: [messageId] });
    }

    if (hasUnreadPollVote) {
      markPollVotesRead({ chatId, messageIds: [messageId] });
    }

    let unreadMentionIds: number[] = [];
    if (message.hasUnreadMention) {
      unreadMentionIds = [messageId];
    }

    if (album) {
      unreadMentionIds = album.messages.filter((msg) => msg.hasUnreadMention).map((msg) => msg.id);
    }

    if (unreadMentionIds.length) {
      markMentionsRead({ chatId, messageIds: unreadMentionIds });
    }
  }, [
    hasUnreadReaction,
    hasUnreadPollVote,
    album,
    chatId,
    isQuickPreview,
    isOwn,
    isTypingDraft,
    isLocalOnly,
    markMessageListRead,
    messageId,
    memoFirstUnreadIdRef,
    animateUnreadReaction,
    markPollVotesRead,
    message.hasUnreadMention,
    message.wasTypingDraft,
  ]);

  const extraPadding = asForwarded && !isCustomShape ? 28 : 0;

  const sizeCalculations = useMemo(() => {
    let style = '';

    if (sticker && !hasSubheader) {
      const { width } = getStickerDimensions(sticker, isMobile);
      style = `width: ${width + extraPadding}px`;
    }

    return style;
  }, [
    extraPadding, hasSubheader, isMobile, sticker,
  ]);

  const contentStyle = buildStyle(peerColorStyle, sizeCalculations);

  // A message that was never stored has no recipients, so its click names the reason
  const handleOutgoingStatusClick = useLastCallback(() => {
    if (isLocal) {
      showNotification({ message: { key: message.sendError ? getSendErrorKey(message.sendError) : 'SendErrorOther' } });
      return;
    }
    openMessageDetailsModal({ chatId, messageId });
  });

  const handleTypingAnimationEnd = useLastCallback(() => {
    if (!isTypingDraft || !previousLocalId) {
      return;
    }

    markTypingDraftDone({ chatId, messageId });
  });

  function renderMessageText() {
    if (!textMessage) return undefined;

    if (textMessage.content.richMessage) {
      return (
        <MessageRichText
          message={textMessage}
          focusedQuote={quoteToHighlight}
          focusedQuoteOffset={focusedQuoteOffset}
          isOwn={isOwn}
          noAvatars={noAvatars}
          canAutoLoadMedia={canAutoLoadMedia}
          isProtected={isProtected}
          noPlaylist={isScheduled}
          theme={theme}
          observeIntersectionForLoading={observeIntersectionForLoading}
          observeIntersectionForPlaying={observeIntersectionForPlaying}
          threadId={threadId}
        />
      );
    }

    return (
      <MessageText
        messageOrStory={textMessage}
        emojiSize={emojiSize}
        isProtected={isProtected}
        observeIntersectionForLoading={observeIntersectionForLoading}
        observeIntersectionForPlaying={observeIntersectionForPlaying}
        withTranslucentThumbs={isCustomShape}
        isInSelectMode={isInSelectMode}
        canBeEmpty={hasFactCheck || isTypingDraft}
        maxTimestamp={maxTimestamp}
        threadId={threadId}
        shouldAnimateTyping={isTypingDraft}
        noInitialTypingAnimation={message.shouldSkipTypingAnimation}
        canAnimateTextStreaming={canAnimateTextStreaming}
        onTypingAnimationEnd={handleTypingAnimationEnd}
      />
    );
  }

  const renderQuickReactionButton = useCallback(() => {
    if (!defaultReaction) return undefined;

    return (
      <div
        className={buildClassName(
          'quick-reaction',
          'no-selection',
          isQuickReactionVisible && !hasActiveReactions && 'visible',
        )}
        onClick={handleSendQuickReaction}
        ref={quickReactionRef}
      >
        <ReactionStaticEmoji
          reaction={defaultReaction}
          size={QUICK_REACTION_SIZE}
          availableReactions={availableReactions}
          observeIntersection={observeIntersectionForPlaying}
        />
      </div>
    );
  }, [
    hasActiveReactions, availableReactions, defaultReaction, handleSendQuickReaction, isQuickReactionVisible,
    observeIntersectionForPlaying,
  ]);

  function renderReactionsAndMeta() {
    const meta = (
      <MessageMeta
        message={message}
        isPinned={isPinned}
        withFullDate={isChatWithSelf && !isOwn}
        isMessagePrimaryEditedDateEnabled={isMessagePrimaryEditedDateEnabled}
        noReplies={noReplies}
        repliesThreadInfo={repliesThreadInfo}
        outgoingStatus={outgoingStatus}
        signature={signature}
        withReactionOffset={reactionsPosition === 'inside'}
        renderQuickReactionButton={
          withQuickReactionButton && quickReactionPosition === 'in-meta' ? renderQuickReactionButton : undefined
        }
        availableReactions={availableReactions}
        onClick={handleMetaClick}
        onOutgoingStatusClick={outgoingStatus === 'failed' || outgoingStatus === 'partial'
          ? handleOutgoingStatusClick : undefined}
        onOpenThread={handleOpenThread}
      />
    );

    if (reactionsPosition !== 'inside') {
      return meta;
    }

    return (
      <Reactions
        message={reactionMessage!}
        threadId={threadId}
        metaChildren={meta}
        observeIntersection={observeIntersectionForPlaying}
        noRecentReactors={isChannel}
        tags={tags}
        isAccountFrozen={isAccountFrozen}
      />
    );
  }

  function renderContent() {
    const className = buildClassName(
      'content-inner',
      asForwarded && 'forwarded-message',
      hasForwardedCustomShape && 'forwarded-custom-shape',
      hasSubheader && 'with-subheader',
    );
    const hasCustomAppendix = isLastInGroup
      && (!hasText || (isInvertedMedia && !hasFactCheck && reactionsPosition !== 'inside')) && !withCommentButton;
    const textContentClass = buildClassName(
      'text-content',
      'clearfix',
      metaPosition === 'in-text' && 'with-meta',
      outgoingStatus && 'with-outgoing-icon',
    );
    const shouldReadMedia = !hasTtl || !isOwn || isChatWithSelf;
    let ephemeralBotName: string | undefined;
    if (isLocalOnly && message.isOutgoing) {
      if (!ephemeralBot) {
        ephemeralBotName = lang('Bot');
      } else if (ephemeralBot.hasUsername) {
        ephemeralBotName = `@${getMainUsername(ephemeralBot)}`;
      } else {
        ephemeralBotName = getPeerFullTitle(lang, ephemeralBot);
      }
    }

    return (
      <div className={className} onDoubleClick={handleContentDoubleClick} dir="auto">
        {!asForwarded && shouldRenderSenderName() && renderSenderName()}
        {hasSubheader && (
          <div className="message-subheader">
            {message.isEphemeral && (
              <BadgeButton className="ephemeral-header">
                <Icon name="eye-outline" />
                <span dir="auto">
                  {message.isOutgoing && isLocalOnly
                    ? lang('EphemeralOnlyVisibleToBot', { bot: ephemeralBotName! })
                    : lang('EphemeralOnlyVisible')}
                </span>
              </BadgeButton>
            )}
            {hasForwardedCustomShape && (
              <div className="forward-custom-shape-subheader">
                <div className="message-title">
                  {renderForwardTitle()}
                </div>
                {renderSenderName(true, true)}
              </div>
            )}
            {hasMessageReply && (
              <EmbeddedMessage
                message={replyMessage}
                replyInfo={messageReplyInfo}
                noUserColors={noUserColors}
                isProtected={isProtected}
                sender={replyMessageSender}
                senderChat={replyMessageChat}
                forwardSender={replyMessageForwardSender}
                isMediaNsfw={isReplyMediaNsfw}
                observeIntersectionForLoading={observeIntersectionForLoading}
                observeIntersectionForPlaying={observeIntersectionForPlaying}
                onClick={message.isEphemeral ? undefined : handleReplyClick}
              />
            )}
            {hasStoryReply && (
              <EmbeddedStory
                story={replyStory}
                sender={storySender}
                noUserColors={noUserColors}
                isProtected={isProtected}
                observeIntersectionForLoading={observeIntersectionForLoading}
                observeIntersectionForPlaying={observeIntersectionForPlaying}
                onClick={handleStoryClick}
              />
            )}
          </div>
        )}
        {sticker && observeIntersectionForLoading && observeIntersectionForPlaying && (
          <Sticker
            message={message}
            observeIntersection={observeIntersectionForLoading}
            observeIntersectionForPlaying={observeIntersectionForPlaying}
            shouldLoop={shouldLoopStickers}
            shouldPlayEffect={shouldPlayEffect}
            withEffect={withAnimatedEffects}
            isMediaNsfw={isMediaNsfw}
            onStopEffect={hideEffect}
          />
        )}
        {hasAnimatedEmoji && animatedCustomEmoji && (
          <AnimatedCustomEmoji
            customEmojiId={animatedCustomEmoji}
            withEffects={withAnimatedEffects && isChatWithUser}
            isOwn={isOwn}
            observeIntersection={observeIntersectionForLoading}
            forceLoadPreview={isLocal}
            messageId={messageId}
            chatId={chatId}
            activeEmojiInteractions={activeEmojiInteractions}
          />
        )}
        {hasAnimatedEmoji && animatedEmoji && (
          <AnimatedEmoji
            emoji={animatedEmoji}
            withEffects={withAnimatedEffects && isChatWithUser}
            isOwn={isOwn}
            observeIntersection={observeIntersectionForLoading}
            forceLoadPreview={isLocal}
            messageId={messageId}
            chatId={chatId}
            activeEmojiInteractions={activeEmojiInteractions}
          />
        )}
        {phoneCall && (
          <MessagePhoneCall
            message={message}
            phoneCall={phoneCall}
            chatId={chatId}
          />
        )}
        {!isAlbum && isRoundVideo && (
          <RoundVideo
            message={message}
            threadId={threadId}
            isInScheduled={isScheduled}
            observeIntersection={observeIntersectionForLoading}
            canAutoLoad={canAutoLoadMedia}
            isDownloading={isDownloading}
            onReadMedia={shouldReadMedia ? handleReadMedia : undefined}
          />
        )}
        {(audio || voice) && (
          <Audio
            theme={theme}
            message={message}
            variant="inline"
            threadId={threadId}
            isInScheduled={isScheduled}
            noPlaylist={isScheduled}
            uploadProgress={uploadProgress}
            isSelectable={isInDocumentGroup}
            isSelected={isSelected}
            noAvatars={noAvatars}
            onPlay={handleAudioPlay}
            onReadMedia={voice && shouldReadMedia ? handleReadMedia : undefined}
            onCancelUpload={handleCancelUpload}
            isDownloading={isDownloading}
            canDownload={!isProtected}
          />
        )}
        {document && (
          <Document
            document={document}
            message={message}
            observeIntersection={observeIntersectionForLoading}
            canAutoLoad={canAutoLoadMedia}
            autoLoadFileMaxSizeMb={autoLoadFileMaxSizeMb}
            uploadProgress={uploadProgress}
            isSelectable={isInDocumentGroup}
            isSelected={isSelected}
            onMediaClick={handleDocumentClick}
            onCancelUpload={handleCancelUpload}
            isDownloading={isDownloading}
            shouldWarnAboutFiles={shouldWarnAboutFiles}
          />
        )}
        {storyData && !isStoryMention && (
          <Story
            message={message}
            isProtected={isProtected}
          />
        )}
        {isStoryMention && <StoryMention message={message} />}
        {contact && (
          <Contact contact={contact} noUserColors={isOwn} />
        )}
        {poll && (
          <Poll
            key={poll.summary.id}
            chatId={chatId}
            messageId={messageId}
            poll={poll}
            messageText={text}
            theme={theme}
            isInScheduled={isScheduled}
            observeIntersectionForLoading={observeIntersectionForLoading}
            observeIntersectionForPlaying={observeIntersectionForPlaying}
          />
        )}
        {dice && (
          <DiceWrapper
            canSendDice={canSendStickers}
            isLocal={isLocal}
            dice={dice}
            isOutgoing={isOwn}
            canPlayWinEffect={shouldPlayDiceEffect}
            onEffectPlayed={hideDiceEffect}
          />
        )}

        {isInvertedMedia && renderInvertedMediaContent(hasCustomAppendix)}

        {!isInvertedMedia && (
          <>
            {renderInvertibleMediaContent(hasCustomAppendix)}
            {isUnsupported && (
              <UnsupportedPlate
                className="unsupported-plate"
                title={lang('UnsupportedMessageTitle')}
                text={lang('MessageUnsupported')}
              />
            )}
            {hasText && !hasAnimatedEmoji && !isUnsupported && (
              <div className={textContentClass} dir="auto" ref={textRef}>
                {renderMessageText()}
                {hasFactCheck && (
                  <FactCheck factCheck={factCheck} isToggleDisabled={isInSelectMode} />
                )}
                {metaPosition === 'in-text' && renderReactionsAndMeta()}
              </div>
            )}
            {renderWebPage()}
          </>
        )}
      </div>
    );
  }

  function renderInvertedMediaContent(hasCustomAppendix: boolean) {
    const textContentClass = buildClassName(
      'text-content',
      'clearfix',
    );
    const footerClass = buildClassName(
      'text-content',
      'clearfix',
      metaPosition === 'in-text' && 'with-meta',
      outgoingStatus && 'with-outgoing-icon',
    );

    const hasMediaAfterText = isAlbum || (!isAlbum && photo) || (!isAlbum && video && !isRoundVideo);
    const hasContentAfterText = hasMediaAfterText || (!hasAnimatedEmoji && hasFactCheck);
    const isMetaInText = metaPosition === 'in-text';

    return (
      <>
        {renderWebPage()}
        {hasText && !hasAnimatedEmoji && (
          <div className={textContentClass} dir="auto" ref={textRef}>
            {renderMessageText()}
            {!hasContentAfterText && isMetaInText && renderReactionsAndMeta()}
          </div>
        )}

        {hasContentAfterText && (
          <>
            {renderInvertibleMediaContent(hasCustomAppendix)}
            {!hasAnimatedEmoji && (
              <div className={footerClass} dir="auto">
                {hasFactCheck && (
                  <FactCheck factCheck={factCheck} isToggleDisabled={isInSelectMode} />
                )}
                {isMetaInText && renderReactionsAndMeta()}
              </div>
            )}
          </>
        )}

      </>
    );
  }

  function renderWebPage() {
    const messageWebPage = getMessageWebPage(message);
    if (!messageWebPage || !webPage) return undefined;
    return (
      <WebPage
        messageWebPage={messageWebPage}
        webPage={webPage}
        message={message}
        observeIntersectionForLoading={observeIntersectionForLoading}
        observeIntersectionForPlaying={observeIntersectionForPlaying}
        noAvatars={noAvatars}
        canAutoLoad={canAutoLoadMedia}
        canAutoPlay={canAutoPlayMedia}
        isDownloading={isDownloading}
        isProtected={isProtected}
        theme={theme}
        story={webPageStory}
        isConnected={isConnected}
        lastPlaybackTimestamp={lastPlaybackTimestamp}
        backgroundEmojiId={messageColorPeer?.color?.backgroundEmojiId}
        shouldWarnAboutFiles={shouldWarnAboutFiles}
        autoLoadFileMaxSizeMb={autoLoadFileMaxSizeMb}
        onAudioPlay={handleAudioPlay}
        onMediaClick={handleMediaClick}
        onDocumentClick={handleDocumentClick}
        onCancelMediaTransfer={handleCancelUpload}
      />
    );
  }

  function renderInvertibleMediaContent(hasCustomAppendix: boolean) {
    const content = (
      <>
        {isAlbum && observeIntersectionForLoading && (
          <Album
            album={album}
            observeIntersection={observeIntersectionForLoading}
            isOwn={isOwn}
            isProtected={isProtected}
            hasCustomAppendix={hasCustomAppendix}
            onMediaClick={handleAlbumMediaClick}
          />
        )}
        {!isAlbum && photo && (
          <Photo
            photo={photo}
            isOwn={isOwn}
            observeIntersection={observeIntersectionForLoading}
            canAutoLoad={canAutoLoadMedia}
            uploadProgress={uploadProgress}
            shouldAffectAppendix={hasCustomAppendix}
            isDownloading={isDownloading}
            isProtected={isProtected}
            theme={theme}
            isMediaNsfw={isMediaNsfw}
            onClick={handlePhotoMediaClick}
            onCancelUpload={handleCancelUpload}
          />
        )}
        {!isAlbum && video && !isRoundVideo && (
          <Video
            video={video}
            observeIntersectionForLoading={observeIntersectionForLoading}
            observeIntersectionForPlaying={observeIntersectionForPlaying}
            canAutoLoad={canAutoLoadMedia}
            canAutoPlay={canAutoPlayMedia}
            uploadProgress={uploadProgress}
            isDownloading={isDownloading}
            isProtected={isProtected}
            isMediaNsfw={isMediaNsfw}
            lastPlaybackTimestamp={lastPlaybackTimestamp}
            onClick={handleVideoMediaClick}
            onCancelUpload={handleCancelUpload}
          />
        )}
      </>
    );

    return content;
  }

  function shouldRenderSenderName() {
    const media = photo || video;
    return !isCustomShape && (
      (withSenderName && !media) || asForwarded || forceSenderName
    ) && !isInDocumentGroupNotFirst && !(hasMessageReply && isCustomShape);
  }

  function renderForwardTitle() {
    return (
      <span className="forward-title-container">
        {asForwarded && (
          <Icon name={forwardInfo?.hiddenUserName ? 'forward' : 'share-filled'} />
        )}
        {asForwarded && (
          <span className="forward-title">
            {lang('ForwardedFrom')}
          </span>
        )}
      </span>
    );
  }

  function renderSenderName(
    shouldSkipRenderForwardTitle: boolean = false, shouldSkipRenderAdminTitle: boolean = false,
  ) {
    let senderTitle;
    if (senderPeer) {
      senderTitle = getPeerFullTitle(lang, senderPeer);
    } else if (forwardInfo?.hiddenUserName) {
      senderTitle = forwardInfo.hiddenUserName;
    } else if (storyData && originSender) {
      senderTitle = getPeerFullTitle(lang, originSender);
    }
    const senderEmojiStatus = senderPeer && 'emojiStatus' in senderPeer && senderPeer.emojiStatus;

    const shouldRenderForwardAvatar = asForwarded && senderPeer;
    const adminTitle = (!shouldSkipRenderAdminTitle && !signature) ? (forwardInfo?.isLinkedChannelPost ? (
      <span className="admin-title" dir="auto">{lang('DiscussChannel')}</span>
    ) : message.postAuthorTitle && isGroup && !asForwarded ? (
      <span className="admin-title" dir="auto">{message.postAuthorTitle}</span>
    ) : (senderChatMember || fromRank) && !asForwarded ? (
      <RankBadge
        chatId={chatId}
        userId={(senderChatMember?.userId || sender?.id)!}
        isAdmin={senderChatMember?.isAdmin}
        isOwner={senderChatMember?.isOwner}
        rank={senderChatMember?.rank || fromRank}
        className="admin-title-badge"
        isClickable
      />
    ) : undefined) : undefined;

    return (
      <div className="message-title" dir="ltr">
        {(senderTitle || asForwarded) ? (
          <span
            className={buildClassName(
              'message-title-name-container',
              forwardInfo?.hiddenUserName ? 'sender-hidden' : 'interactive',
            )}
            dir="ltr"
          >
            {!shouldSkipRenderForwardTitle && renderForwardTitle()}
            <span className="message-title-name">
              {storyData && <Icon name="play-story" />}
              {shouldRenderForwardAvatar && (
                <Avatar
                  className="forward-avatar"
                  peer={senderPeer}
                  size="micro"
                />
              )}
              <span
                className="sender-title"
                onClick={handleSenderClick}
              >
                {senderTitle ? renderText(senderTitle) : (asForwarded ? NBSP : undefined)}
              </span>
              {!asForwarded && senderEmojiStatus && (
                <CustomEmoji
                  documentId={senderEmojiStatus.documentId}
                  className="no-selection"
                  loopLimit={EMOJI_STATUS_LOOP_LIMIT}
                  observeIntersectionForLoading={observeIntersectionForLoading}
                  observeIntersectionForPlaying={observeIntersectionForPlaying}
                />
              )}
              {senderPeer?.fakeType && <FakeIcon fakeType={senderPeer.fakeType} />}
            </span>
          </span>
        ) : NBSP}
        <div className="title-spacer" />
        {adminTitle && (
          <span className="message-title-meta">
            {adminTitle}
          </span>
        )}
      </div>
    );
  }

  const forwardAuthor = isGroup && asForwarded ? message.postAuthorTitle : undefined;

  return (
    <div
      ref={ref}
      id={getMessageHtmlId(message.id)}
      className={containerClassName}
      data-message-id={messageId}
      onCopy={isProtected ? stopEvent : undefined}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={isInDocumentGroupNotLast ? handleDocumentGroupMouseEnter : undefined}
      onMouseMove={withQuickReactionButton ? handleMouseMove : undefined}
      onMouseLeave={(withQuickReactionButton || isInDocumentGroupNotLast) ? handleMouseLeave : undefined}
    >
      <div
        ref={bottomMarkerRef}
        className="bottom-marker"
        data-message-id={messageId}
        data-last-message-id={album ? album.messages[album.messages.length - 1].id : undefined}
        data-album-main-id={album ? album.mainMessage.id : undefined}
        data-has-unread-mention={message.hasUnreadMention || undefined}
        data-has-unread-poll-vote={hasUnreadPollVote || undefined}
        data-has-unread-reaction={hasUnreadReaction || undefined}
        data-is-pinned={isPinned || undefined}
        data-should-update-views={message.viewsCount !== undefined}
      />
      {!isInDocumentGroup && (
        <div className="message-select-control no-selection">
          {isSelected && <Icon name="check" className="message-select-control-icon" />}
        </div>
      )}
      {isLastInDocumentGroup && (
        <div
          className={buildClassName(
            'message-select-control group-select no-selection', isGroupSelected && 'is-selected',
          )}
          onClick={handleDocumentGroupSelectAll}
        >
          {isGroupSelected && (
            <Icon name="check" className="message-select-control-icon" />
          )}
        </div>
      )}
      <div
        className={buildClassName('message-content-wrapper',
          contentClassName.includes('text') && 'can-select-text')}
      >
        <div
          className={contentClassName}
          style={contentStyle}
          dir="auto"
        >
          {asForwarded && !isInDocumentGroupNotFirst && (
            <>
              {shouldRenderSenderName() && renderSenderName()}
              {forwardAuthor && <span className="admin-title" dir="auto">{forwardAuthor}</span>}
            </>
          )}
          {renderContent()}
          {!isInDocumentGroupNotLast && metaPosition === 'standalone' && !isStoryMention && renderReactionsAndMeta()}
          {canShowActionButton && (
            <div className="message-action-buttons-container">
              <div className={buildClassName(
                'message-action-buttons',
                isLoadingComments && 'message-action-buttons-shown',
              )}
              >
                {withCommentButton && isCustomShape && (
                  <CommentButton
                    threadInfo={commentsThreadInfo}
                    disabled={noComments || !commentsThreadInfo}
                    isLoading={isLoadingComments}
                    isCustomShape
                  />
                )}
                {canForward && (
                  <Button
                    className="message-action-button"
                    color="translucent-white"
                    round
                    ariaLabel={lang('Forward')}
                    onClick={isLastInDocumentGroup ? handleGroupForward : handleForward}
                    iconName="share-filled"
                  />
                )}
                {canFocus && (
                  <Button
                    className="message-action-button"
                    color="translucent-white"
                    round
                    ariaLabel={lang('FocusMessage')}
                    onClick={isPinnedList ? handleFocus : handleFocusForwarded}
                    iconName="arrow-right"
                  />
                )}
              </div>
            </div>
          )}
          {withCommentButton && !isCustomShape && (
            <CommentButton
              threadInfo={commentsThreadInfo}
              disabled={noComments || !commentsThreadInfo}
              isLoading={isLoadingComments}
            />
          )}
          {withAppendix && <MessageAppendix isOwn={isOwn} />}
          {withQuickReactionButton && quickReactionPosition === 'in-content' && renderQuickReactionButton()}
        </div>
        {reactionsPosition === 'outside' && !isStoryMention && (
          <Reactions
            message={reactionMessage!}
            threadId={threadId}
            isOutside
            observeIntersection={observeIntersectionForPlaying}
            noRecentReactors={isChannel}
            tags={tags}
            isAccountFrozen={isAccountFrozen}
          />
        )}
      </div>
      {contextMenuAnchor && (
        <ContextMenuContainer
          isOpen={isContextMenuOpen}
          anchor={contextMenuAnchor}
          targetHref={contextMenuTarget?.matches('a[href]') ? (contextMenuTarget as HTMLAnchorElement).href : undefined}
          message={message}
          album={album}
          messageListType={messageListType}
          threadId={threadId}
          onClose={handleContextMenuClose}
          onCloseAnimationEnd={handleContextMenuHide}
          repliesThreadInfo={repliesThreadInfo}
          noReplies={noReplies}
        />
      )}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, ownProps): Complete<StateProps> => {
    const {
      focusedMessage, forwardMessages, activeReactions, activeEmojiInteractions,
      loadingThread,
    } = selectTabState(global);
    const {
      message, album, documentGroup, withSenderName, withAvatar, threadId, messageListType,
      isLastInDocumentGroup, shouldIgnoreSendFocus,
    } = ownProps;
    const {
      id, chatId, isOutgoing, forwardInfo, isPinned,
    } = message;

    const webPage = selectFullWebPageFromMessage(global, message);

    const { shouldWarnAboutFiles } = selectSharedSettings(global);
    const isChatWithUser = isUserId(chatId);

    const chat = selectChat(global, chatId);
    const isChatWithSelf = selectIsChatWithSelf(global, chatId);
    const isChannel = chat && isChatChannel(chat);
    const isGroup = chat && isChatGroup(chat);
    const chatFullInfo = !isChatWithUser ? selectChatFullInfo(global, chatId) : undefined;
    const { adminMembersById, members } = chatFullInfo || {};
    const webPageStoryData = webPage?.story;
    const webPageStory = webPageStoryData
      ? selectPeerStory(global, webPageStoryData.peerId, webPageStoryData.id)
      : undefined;

    const isForwarding = forwardMessages.messageIds && forwardMessages.messageIds.includes(id);
    const forceSenderName = !isChatWithSelf && isAnonymousOwnMessage(message);
    const canShowSender = withSenderName || withAvatar || forceSenderName;
    const sender = selectSender(global, message);
    const originSender = selectForwardedSender(global, message);
    const ephemeralBot = message.ephemeralBotId ? selectUser(global, message.ephemeralBotId) : undefined;
    const senderChatMember = sender?.id
      ? (adminMembersById?.[sender?.id] || members?.find((member) => member.userId === sender?.id))
      : undefined;

    const replyInfo = getMessageReplyInfo(message) || getEphemeralReplyInfo(message);
    const replyToMsgId = replyInfo?.replyToMsgId;
    const replyToPeerId = replyInfo?.type === 'message' ? replyInfo.replyToPeerId : undefined;
    const replyFrom = replyInfo?.type === 'message' ? replyInfo.replyFrom : undefined;
    const { peerId: storyReplyPeerId, storyId: storyReplyId } = getStoryReplyInfo(message) || {};

    const shouldHideReply = replyToMsgId && replyToMsgId === threadId;
    const replyMessage = selectReplyMessage(global, message);
    const forwardHeader = forwardInfo || replyFrom;
    const replyMessageSender = replyMessage ? selectSender(global, replyMessage)
      : forwardHeader
        ? selectSenderFromHeader(global, forwardHeader) : undefined;
    const replyMessageForwardSender = replyMessage && selectForwardedSender(global, replyMessage);
    const replyMessageChat = replyToPeerId ? selectChat(global, replyToPeerId) : undefined;
    const isReplyPrivate = replyMessageChat
      && !isChatPublic(replyMessageChat)
      && (replyMessageChat.isNotJoined || selectIsChatRestricted(global, replyMessageChat.id));
    const isReplyToTopicStart = replyMessage?.content.action?.type === 'topicCreate';
    const replyStory = storyReplyId && storyReplyPeerId
      ? selectPeerStory(global, storyReplyPeerId, storyReplyId)
      : undefined;
    const storySender = storyReplyPeerId ? selectPeer(global, storyReplyPeerId) : undefined;

    const uploadProgress = selectUploadProgress(global, message);
    const isFocusTarget = messageListType === 'thread' && (
      album
        ? album.messages.some((m) => selectIsMessageFocused(global, m, threadId))
        : selectIsMessageFocused(global, message, threadId)
    );
    const shouldIgnoreFocus = Boolean(
      isFocusTarget
      && shouldIgnoreSendFocus
      && focusedMessage?.noHighlight
      && focusedMessage.isResizingContainer,
    );
    const isFocused = isFocusTarget && !shouldIgnoreFocus;

    const {
      direction: focusDirection, noHighlight: noFocusHighlight, isResizingContainer,
      quote: focusedQuote, quoteOffset: focusedQuoteOffset, scrollTargetPosition,
      pollOption: focusedPollOption,
    } = (isFocused && focusedMessage) || {};

    const middleSearch = selectCurrentMiddleSearch(global);
    const highlight = middleSearch?.results?.query
      && `${middleSearch.isHashtag ? '#' : ''}${middleSearch.results.query}`;

    const singleEmoji = getMessageSingleRegularEmoji(message);
    const animatedEmoji = singleEmoji && selectAnimatedEmoji(global, singleEmoji) ? singleEmoji : undefined;
    const animatedCustomEmoji = getMessageSingleCustomEmoji(message);

    let isSelected: boolean;
    if (album?.messages) {
      isSelected = album.messages.every(({ id: messageId }) => selectIsMessageSelected(global, messageId));
    } else {
      isSelected = selectIsMessageSelected(global, id);
    }

    const canReply = messageListType === 'thread' && selectCanReplyToMessage(global, message, threadId);
    const activeDownloads = selectActiveDownloads(global);
    const downloadableMedia = selectMessageDownloadableMedia(global, message);
    const isDownloading = downloadableMedia && getIsDownloading(activeDownloads, downloadableMedia);

    const isInDocumentGroup = Boolean(message.groupedId) && !message.isInAlbum;

    const repliesThreadInfo = selectThreadInfo(
      global, chatId, album?.commentsMessage?.id || documentGroup?.commentsMessage?.id || id,
    );
    const reactionMessage = isInDocumentGroup ? (
      isLastInDocumentGroup && documentGroup?.firstMessageId
        ? selectChatMessage(global, chatId, documentGroup.firstMessageId)
        : undefined
    ) : message;

    const readState = selectThreadReadState(global, chatId, threadId);
    const hasUnreadReaction = readState?.unreadReactions?.includes(message.id);
    const hasUnreadPollVote = readState?.unreadPollVotes?.includes(message.id);

    const isConnected = global.connectionState === 'connectionStateReady';

    const hasActiveReactions = Boolean(reactionMessage && activeReactions[getMessageKey(reactionMessage)]?.length);

    const poll = selectPollFromMessage(global, message);

    const maxTimestamp = selectMessageTimestampableDuration(global, message);

    const lastPlaybackTimestamp = selectMessageLastPlaybackTimestamp(global, chatId, message.id);
    const isAccountFrozen = selectIsCurrentUserFrozen(global);

    const isMediaNsfw = selectIsMediaNsfw(global, message);
    const isReplyMediaNsfw = replyMessage && selectIsMediaNsfw(global, replyMessage);

    const allowedAttachmentOptions = getAllowedAttachmentOptions(chat);

    return {
      theme: selectTheme(global),
      forceSenderName,
      sender,
      canShowSender,
      originSender,
      ephemeralBot,
      shouldHideReply: shouldHideReply || isReplyToTopicStart,
      replyMessage,
      replyMessageSender,
      replyMessageForwardSender,
      replyMessageChat,
      replyStory,
      isReplyPrivate,
      storySender,
      isInDocumentGroup,
      isProtected: selectIsMessageProtected(global, message),
      canForward: Boolean(
        isChannel && messageListType !== 'scheduled' && selectCanForwardMessage(global, message),
      ),
      isFocused,
      isForwarding,
      reactionMessage,
      isChatWithSelf,
      isChannel,
      isGroup,
      canReply: message.isEphemeral ? getCanReplyToEphemeralMessage(message) : canReply,
      highlight,
      animatedEmoji,
      animatedCustomEmoji,
      isInSelectMode: !message.isEphemeral && selectIsInSelectMode(global),
      isSelected: message.isEphemeral ? false : isSelected,
      isGroupSelected: !message.isEphemeral && (
        Boolean(message.groupedId)
        && !message.isInAlbum
        && selectIsDocumentGroupSelected(global, chatId, message.groupedId)
      ),
      threadId,
      isDownloading,
      isPinnedList: messageListType === 'pinned',
      isPinned,
      isMessagePrimaryEditedDateEnabled: Boolean(global.appConfig.isMessagePrimaryEditedDateEnabled),
      canAutoLoadMedia: selectCanAutoLoadMedia(global, message),
      canAutoPlayMedia: selectCanAutoPlayMedia(global, message),
      autoLoadFileMaxSizeMb: global.settings.byKey.autoLoadFileMaxSizeMb,
      shouldLoopStickers: selectShouldLoopStickers(global),
      repliesThreadInfo,
      availableReactions: global.reactions.availableReactions,
      defaultReaction: message.isEphemeral || isMessageLocal(message) || messageListType === 'scheduled'
        ? undefined : selectDefaultReaction(global, chatId),
      hasActiveReactions: message.isEphemeral ? false : hasActiveReactions,
      activeEmojiInteractions,
      hasUnreadReaction,
      hasUnreadPollVote,
      senderChatMember,
      hasLinkedChat: Boolean(chatFullInfo?.linkedChatId),
      withAnimatedEffects: selectPerformanceSettingsValue(global, 'stickerEffects'),
      canAnimateTextStreaming: selectPerformanceSettingsValue(global, 'textStreaming'),
      webPageStory,
      isConnected,
      isLoadingComments: repliesThreadInfo?.isCommentsInfo
        && loadingThread?.loadingChatId === repliesThreadInfo?.originChannelId
        && loadingThread?.loadingMessageId === repliesThreadInfo?.originMessageId,
      shouldWarnAboutFiles,
      outgoingStatus: isOutgoing
        ? message.isEphemeral
          ? selectEphemeralOutgoingStatus(global, chatId, message.id)
          : selectOutgoingStatus(global, chatId, threadId, message.id, messageListType)
        : undefined,
      uploadProgress: typeof uploadProgress === 'number' ? uploadProgress : undefined,
      focusDirection: isFocused ? focusDirection : undefined,
      noFocusHighlight: isFocused ? noFocusHighlight : undefined,
      isResizingContainer: isFocused ? isResizingContainer : undefined,
      focusedQuote: isFocused ? focusedQuote : undefined,
      focusedQuoteOffset: isFocused ? focusedQuoteOffset : undefined,
      focusedPollOption: isFocused ? focusedPollOption : undefined,
      scrollTargetPosition: isFocused ? scrollTargetPosition : undefined,
      tags: global.savedReactionTags?.byKey,
      poll,
      maxTimestamp,
      lastPlaybackTimestamp,
      isChatWithUser,
      isAccountFrozen,
      isMediaNsfw,
      isReplyMediaNsfw,
      webPage,
      canSendStickers: allowedAttachmentOptions.canSendStickers,
    };
  },
)(Message));
