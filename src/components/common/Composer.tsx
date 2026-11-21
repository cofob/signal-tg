import type { TeactNode } from '../../lib/teact/teact';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../global';

import type {
  ApiAttachment,
  ApiAttachMenuPeerType,
  ApiAvailableReaction,
  ApiBotCommand,
  ApiBotInlineMediaResult,
  ApiBotInlineResult,
  ApiBotMenuButton,
  ApiChat,
  ApiChatFullInfo,
  ApiDraft,
  ApiFormattedText,
  ApiInputRichMessage,
  ApiMessage,
  ApiMessageEntity,
  ApiPeer,
  ApiReaction,
  ApiSticker,
  ApiTopic,
  ApiUser,
  ApiVideo,
  ApiWebPage,
} from '../../api/types';
import type { GlobalState, TabState } from '../../global/types';
import type {
  EditingDraft,
  IAnchorPosition,
  InlineBotSettings,
  MessageList,
  MessageListType,
  ThemeKey,
  ThreadId,
} from '../../types';
import type { RegularLangKey } from '../../types/language';
import type { MediaEditorResult } from '../ui/mediaEditor/MediaEditor';
import type { RichEditorTooltipsConfig } from './tooltips/types';
import { ApiMediaFormat, ApiMessageEntityTypes, MAIN_THREAD_ID } from '../../api/types';

import {
  BASE_EMOJI_KEYWORD_LANG,
  HEART_REACTION,
  MIN_ROUND_VIDEO_RECORDING_TIME,
  ONE_TIME_MEDIA_TTL_SECONDS,
  ROUND_VIDEO_RECORDING_SIZE,
  SCHEDULED_WHEN_ONLINE,
  SEND_MESSAGE_ACTION_INTERVAL,
  VIDEO_RECORDING_FILENAME,
} from '../../config';
import { requestMeasure, requestNextMutation } from '../../lib/fasterdom/fasterdom';
import {
  canEditMedia,
  getAllowedAttachmentOptions,
  getMainUsername,
  getMediaFilename,
  getMediaHash,
  getMessageDocumentPhoto,
  getMessagePhoto,
  getMessageVideo,
  getPhotoFullDimensions,
  getReactionKey,
  getStoryKey,
  hasMessageMedia,
  isChatAdmin,
  isChatChannel,
  isChatPublic,
  isChatSuperGroup,
  isSameReaction,
  isSystemBot,
  isUserRightBanned,
} from '../../global/helpers';
import { getChatNotifySettings } from '../../global/helpers/notifications';
import { getPeerTitle } from '../../global/helpers/peers';
import { getRichMessageUsage } from '../../global/helpers/richMessage';
import {
  selectBot,
  selectCanManageAutoDelete,
  selectCanPlayAnimatedEmojis,
  selectCanScheduleUntilOnline,
  selectChat,
  selectChatFullInfo,
  selectChatHistoryTtl,
  selectChatMessage,
  selectChatMessageOrEphemeral,
  selectChatType,
  selectCurrentMessageList,
  selectCurrentMiddleSearch,
  selectCustomEmoji,
  selectEditingMessage,
  selectEphemeralMessage,
  selectIsChatWithSelf,
  selectIsCurrentUserFrozen,
  selectIsCurrentUserPremium,
  selectIsInSelectMode,
  selectIsReactionPickerOpen,
  selectIsRightColumnShown,
  selectLanguageCode,
  selectNewestMessageWithBotKeyboardButtons,
  selectNotifyDefaults,
  selectNotifyException,
  selectPeer,
  selectPeerStory,
  selectRequestedDraft,
  selectRequestedDraftFiles,
  selectStoppableTypingDraftId,
  selectTabState,
  selectTheme,
  selectTopicFromMessage,
  selectUser,
  selectUserFullInfo,
  selectWebPagePreview,
} from '../../global/selectors';
import { selectSharedSettings } from '../../global/selectors/sharedState';
import {
  selectDraft,
  selectEditingDraft,
  selectEditingScheduledDraft,
  selectNoWebPage,
  selectTabThreadParam,
} from '../../global/selectors/threads';
import { revokeAttachmentUrls } from '../../util/attachments';
import {
  IS_ANDROID, IS_IOS, IS_TOUCH_ENV, IS_VIDEO_RECORDING_SUPPORTED, IS_VOICE_RECORDING_SUPPORTED,
} from '../../util/browser/windowEnvironment';
import buildClassName from '../../util/buildClassName';
import captureEscKeyListener from '../../util/captureEscKeyListener';
import { formatCountdown, formatMediaDuration } from '../../util/dates/duration';
import { processDeepLink } from '../../util/deeplink';
import { tryParseDeepLink } from '../../util/deepLinkParser';
import calcTextLineHeightAndCount from '../../util/element/calcTextLineHeightAndCount';
import { isUserId } from '../../util/entities/ids';
import { fetchBlob } from '../../util/files';
import focusEditableElement from '../../util/focusEditableElement';
import { fetch } from '../../util/mediaLoader';
import { MEMO_EMPTY_ARRAY } from '../../util/memo';
import { getServerTime } from '../../util/serverTime';
import stopEvent from '../../util/stopEvent';
import { getUtf8Length } from '../../util/text/textFormat';
import { EMPTY_RICH_MEDIA_CAPTION } from '../../util/tiptap/richMedia';
import windowSize from '../../util/windowSize';
import { LIMITS } from '../../limits';
import applyIosAutoCapitalizationFix from '../middle/composer/helpers/applyIosAutoCapitalizationFix';
import buildAttachment, {
  buildAttachmentWithVideoCover,
  buildGifAttachment,
  prepareAttachment,
  prepareAttachmentsToSend,
} from '../middle/composer/helpers/buildAttachment';
import { armSendCollapseReserve } from '../middle/helpers/messageListReserves';
import {
  buildRichMessageFromFormatted,
  getRichInputAsFormatted,
  hasUnsupportedRichBlocks,
  isValidInputRichMessage,
  removeUnsupportedRichBlocks,
} from '../ui/textInput/richText';
import { hasActiveRichEditorTooltip } from './tooltips/helpers';

import useInterval from '../../hooks/schedulers/useInterval';
import useTimeout from '../../hooks/schedulers/useTimeout';
import useContextMenuHandlers from '../../hooks/useContextMenuHandlers';
import useCurrentOrPrev from '../../hooks/useCurrentOrPrev';
import useDerivedState from '../../hooks/useDerivedState';
import useEffectWithPrevDeps from '../../hooks/useEffectWithPrevDeps';
import useFlag from '../../hooks/useFlag';
import useForceUpdate from '../../hooks/useForceUpdate';
import useKeyboardShortcutHint from '../../hooks/useKeyboardShortcutHint';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import usePeerColor from '../../hooks/usePeerColor';
import usePreviousDeprecated from '../../hooks/usePreviousDeprecated';
import useResizeObserver from '../../hooks/useResizeObserver';
import useSchedule from '../../hooks/useSchedule';
import useSendMessageAction from '../../hooks/useSendMessageAction';
import useShowTransition from '../../hooks/useShowTransition';
import useShowTransitionDeprecated from '../../hooks/useShowTransitionDeprecated';
import { useStateRef } from '../../hooks/useStateRef';
import useSyncEffect from '../../hooks/useSyncEffect';
import useAttachmentModal from '../middle/composer/hooks/useAttachmentModal';
import useClipboardPaste from '../middle/composer/hooks/useClipboardPaste';
import useDraft from '../middle/composer/hooks/useDraft';
import useEditing from '../middle/composer/hooks/useEditing';
import useLoadLinkPreview from '../middle/composer/hooks/useLoadLinkPreview';
import useRichEditor from '../middle/composer/hooks/useRichEditor';
import useRichMedia from '../middle/composer/hooks/useRichMedia';
import useVideoRecording from '../middle/composer/hooks/useVideoRecording';
import useVoiceRecording from '../middle/composer/hooks/useVoiceRecording';

import AttachmentModal from '../middle/composer/AttachmentModal.async';
import AttachMenu from '../middle/composer/AttachMenu';
import BotCommandMenu from '../middle/composer/BotCommandMenu.async';
import BotKeyboard from '../middle/composer/BotKeyboard';
import BotMenuButton from '../middle/composer/BotMenuButton';
import ComposerEmbeddedMessage from '../middle/composer/ComposerEmbeddedMessage';
import CustomSendMenu from '../middle/composer/CustomSendMenu.async';
import DropArea, { DropAreaState } from '../middle/composer/DropArea.async';
import MessageInput from '../middle/composer/MessageInput.async';
import RecordModeMenu, { type RecordMode } from '../middle/composer/RecordModeMenu';
import RoundVideoRecorder from '../middle/composer/RoundVideoRecorder';
import SendAsMenu from '../middle/composer/SendAsMenu.async';
import SymbolMenuButton from '../middle/composer/SymbolMenuButton';
import VoiceRecordBar from '../middle/composer/VoiceRecordBar';
import WebPagePreview from '../middle/composer/WebPagePreview';
import ReactionSelector from '../middle/message/reactions/ReactionSelector';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import MediaEditor from '../ui/mediaEditor/MediaEditor.async';
import ResponsiveHoverButton from '../ui/ResponsiveHoverButton';
import Spinner from '../ui/Spinner';
import TextTimer from '../ui/TextTimer';
import Transition from '../ui/Transition';
import Avatar from './Avatar';
import AutoDeleteOutlinedIcon from './icons/AutoDeleteOutlinedIcon';
import Icon from './icons/Icon';
import ReactionAnimatedEmoji from './reactions/ReactionAnimatedEmoji';
import RemoveFormattingModal from './RemoveFormattingModal';

import './Composer.scss';

type ComposerType = 'messageList' | 'story';

type OwnProps = {
  type: ComposerType;
  chatId: string;
  threadId: ThreadId;
  storyId?: number;
  messageListType: MessageListType;
  dropAreaState?: string;
  isReady: boolean;
  isMobile?: boolean;
  inputId: string;
  editableInputCssSelector: string;
  editableInputId: string;
  className?: string;
  inputPlaceholder?: TeactNode | string;
  onDropHide?: NoneToVoidFunction;
  onForward?: NoneToVoidFunction;
  onFocus?: NoneToVoidFunction;
  onBlur?: NoneToVoidFunction;
};

type StateProps = {
  stoppableTypingDraftId?: string;
  isOnActiveTab: boolean;
  recordMode: RecordMode;
  editingMessage?: ApiMessage;
  chat?: ApiChat;
  user?: ApiUser;
  chatFullInfo?: ApiChatFullInfo;
  draft?: ApiDraft;
  replyToTopic?: ApiTopic;
  currentMessageList?: MessageList;
  isChatWithBot?: boolean;
  isChatWithSelf?: boolean;
  isChannel?: boolean;
  isForCurrentMessageList: boolean;
  isRightColumnShown?: boolean;
  isSelectModeActive?: boolean;
  isReactionPickerOpen?: boolean;
  isForwarding?: boolean;
  forwardedMessagesCount?: number;
  botKeyboardMessageId?: number;
  botKeyboardPlaceholder?: string;
  hiddenBotKeyboardId?: number;
  hasActiveMiddleSearch?: boolean;
  withScheduledButton?: boolean;
  autoDeletePeriod?: number;
  isInScheduledList?: boolean;
  canScheduleUntilOnline?: boolean;
  currentUserId?: string;
  currentUser?: ApiUser;
  recentEmojis: string[];
  contentToBeScheduled?: TabState['contentToBeScheduled'];
  shouldSuggestStickers?: boolean;
  shouldSuggestCustomEmoji?: boolean;
  baseEmojiKeywords?: Record<string, string[]>;
  emojiKeywords?: Record<string, string[]>;
  topInlineBotIds?: string[];
  topGuestBotIds?: string[];
  isInlineBotLoading: boolean;
  inlineBots?: Record<string, false | InlineBotSettings>;
  botCommands?: ApiBotCommand[] | false;
  botMenuButton?: ApiBotMenuButton;
  sendAsPeer?: ApiPeer;
  sendAsId?: string;
  editingDraft?: EditingDraft;
  requestedDraft?: ApiFormattedText;
  requestedDraftFiles?: File[];
  requestedRichInputMedia?: TabState['requestedRichInputMedia'];
  attachBots: GlobalState['attachMenu']['bots'];
  attachMenuPeerType?: ApiAttachMenuPeerType;
  theme: ThemeKey;
  isCurrentUserPremium?: boolean;
  canSendVoiceByPrivacy?: boolean;
  attachmentSettings: GlobalState['attachmentSettings'];
  slowMode?: ApiChatFullInfo['slowMode'];
  shouldUpdateStickerSetOrder?: boolean;
  availableReactions?: ApiAvailableReaction[];
  topReactions?: ApiReaction[];
  canPlayAnimatedEmojis?: boolean;
  shouldCollectDebugLogs?: boolean;
  sentStoryReaction?: ApiReaction;
  canSendOneTimeMedia?: boolean;
  webPagePreview?: ApiWebPage;
  noWebPage?: boolean;
  richMessageLengthLimit: number;
  richMessageMaxBlocks: number;
  richMessageMaxDepth: number;
  richMessageMaxMedia: number;
  richMessageMaxTableColumns: number;
  isSilentPosting?: boolean;
  isAccountFrozen?: boolean;
  isAppConfigLoaded?: boolean;
  insertingPeerIdMention?: string;
  isRichInputExpanded?: boolean;
  mediaEditorMessage?: ApiMessage;
};

enum MainButtonState {
  Stop = 'stop',
  Send = 'send',
  Record = 'record',
  Edit = 'edit',
  Schedule = 'schedule',
  Forward = 'forward',
  SendOneTime = 'sendOneTime',
}

type ScheduledMessageArgs = TabState['contentToBeScheduled'] | {
  id: string; queryId: string; isSilent?: boolean;
};

const VOICE_RECORDING_FILENAME = 'wonderful-voice-message.ogg';
const CAN_SWITCH_RECORD_MODE = IS_VOICE_RECORDING_SUPPORTED && IS_VIDEO_RECORDING_SUPPORTED;
// When voice recording is active, composer placeholder will hide to prevent overlapping
const SCREEN_WIDTH_TO_HIDE_PLACEHOLDER = 600; // px

const MOBILE_KEYBOARD_HIDE_DELAY_MS = 100;
const SELECT_MODE_TRANSITION_MS = 200;
const SENDING_ANIMATION_DURATION = 350;
const MOUNT_ANIMATION_DURATION = 430;
const APPROXIMATE_RICH_INPUT_FORMAT_OPTIONS = { isApproximate: true };
const MIN_COMPOSER_LINES = 3;

const Composer = ({
  type,
  isOnActiveTab,
  recordMode,
  dropAreaState,
  isInScheduledList,
  canScheduleUntilOnline,
  isReady,
  stoppableTypingDraftId,
  isMobile,
  editingMessage,
  chatId,
  threadId,
  storyId,
  currentMessageList,
  messageListType,
  draft,
  chat,
  chatFullInfo,
  user,
  replyToTopic,
  isForCurrentMessageList,
  isCurrentUserPremium,
  canSendVoiceByPrivacy,
  isChatWithBot,
  isChatWithSelf,
  isChannel,
  isRightColumnShown,
  isSelectModeActive,
  isReactionPickerOpen,
  isForwarding,
  forwardedMessagesCount,
  botKeyboardMessageId,
  botKeyboardPlaceholder,
  hiddenBotKeyboardId,
  hasActiveMiddleSearch,
  inputPlaceholder,
  withScheduledButton,
  autoDeletePeriod,
  topInlineBotIds,
  topGuestBotIds,
  currentUserId,
  currentUser,
  contentToBeScheduled,
  shouldSuggestStickers,
  shouldSuggestCustomEmoji,
  baseEmojiKeywords,
  emojiKeywords,
  recentEmojis,
  inlineBots,
  isInlineBotLoading,
  botCommands,
  sendAsPeer,
  sendAsId,
  editingDraft,
  requestedDraft,
  requestedDraftFiles,
  requestedRichInputMedia,
  botMenuButton,
  attachBots,
  attachMenuPeerType,
  attachmentSettings,
  theme,
  slowMode,
  shouldUpdateStickerSetOrder,
  editableInputCssSelector,
  editableInputId,
  inputId,
  className,
  availableReactions,
  topReactions,
  canPlayAnimatedEmojis,
  shouldCollectDebugLogs,
  sentStoryReaction,
  canSendOneTimeMedia,
  webPagePreview,
  noWebPage,
  richMessageLengthLimit,
  richMessageMaxBlocks,
  richMessageMaxDepth,
  richMessageMaxMedia,
  richMessageMaxTableColumns,
  isSilentPosting,
  isAccountFrozen,
  isAppConfigLoaded,
  insertingPeerIdMention,
  isRichInputExpanded,
  mediaEditorMessage,
  onDropHide,
  onFocus,
  onBlur,
  onForward,
}: OwnProps & StateProps) => {
  const {
    sendMessage,
    stopTypingDraft,
    clearDraft,
    showDialog,
    loadScheduledHistory,
    openThread,
    addRecentEmoji,
    sendInlineBotResult,
    loadSendAs,
    resetOpenChatWithDraft,
    resetRichInputMediaRequest,
    callAttachBot,
    addRecentCustomEmoji,
    showNotification,
    showAllowedMessageTypesNotification,
    openStoryReactionPicker,
    openAutoDeleteTimerModal,
    closeReactionPicker,
    sendStoryReaction,
    editMessage,
    updateAttachmentSettings,
    updateChatSilentPosting,
    updateInsertingPeerIdMention,
    updateShouldSaveAttachmentsCompression,
    applyDefaultAttachmentsCompression,
    setIsRichInputExpanded,
    setSettingOption,
    setHiddenBotKeyboardId,
  } = getActions();

  const lang = useLang();
  const isEditingMedia = Boolean(editingMessage && hasMessageMedia(editingMessage));

  const inputRef = useRef<HTMLDivElement>();
  const composerRef = useRef<HTMLDivElement>();
  const symbolMenuSlotRef = useRef<HTMLDivElement>();

  const storyReactionRef = useRef<HTMLButtonElement>();

  const [isMounted, setIsMounted] = useState(false);
  const lastMessageSendTimeSecondsRef = useRef<number>();
  const prevDropAreaState = usePreviousDeprecated(dropAreaState);
  const { width: windowWidth } = windowSize.get();
  const forceUpdate = useForceUpdate();

  const isInMessageList = type === 'messageList';
  const isRichInputExpansionActive = Boolean(isInMessageList && isRichInputExpanded);
  const isInStoryViewer = type === 'story';
  const sendAsPeerIds = isInMessageList ? chat?.sendAsPeerIds : undefined;
  const canShowSendAs = Boolean(sendAsPeerIds?.length);
  // Prevent Symbol Menu from closing when calendar is open
  const [isSymbolMenuForced, forceShowSymbolMenu, cancelForceShowSymbolMenu] = useFlag();
  const sendMessageAction = useSendMessageAction(chatId, threadId);
  const [isInputHasFocus, markInputHasFocus, unmarkInputHasFocus] = useFlag();
  const [isAttachMenuOpen, onAttachMenuOpen, onAttachMenuClose] = useFlag();
  const [
    isRemoveFormattingModalOpen,
    openRemoveFormattingModal,
    closeRemoveFormattingModal,
  ] = useFlag();
  const shouldFocusAfterFormattingRemovalRef = useRef(false);
  const [
    isRemoveUnsupportedDialogOpen,
    openRemoveUnsupportedDialog,
    closeRemoveUnsupportedDialog,
  ] = useFlag();

  const canMediaBeReplaced = isEditingMedia && canEditMedia(editingMessage!);

  const isMonoforum = chat?.isMonoforum;
  const { members: groupChatMembers, botCommands: chatBotCommands } = chatFullInfo || {};

  const isEphemeralReply = draft?.replyInfo?.type === 'ephemeral';
  const canSchedule = !isMonoforum && !isEphemeralReply;

  const {
    canSendStickers, canSendGifs, canAttachMedia, canAttachPolls, canAttachEmbedLinks,
    canSendVoices, canSendRoundVideos, canSendPlainText, canSendAudios, canSendVideos, canSendPhotos, canSendDocuments,
  } = useMemo(
    () => getAllowedAttachmentOptions(
      chat,
      isChatWithBot,
      isChatWithSelf,
      isInStoryViewer,
      isEphemeralReply,
    ),
    [chat, isChatWithBot, isChatWithSelf, isInStoryViewer, isEphemeralReply],
  );

  const richEditor = useRichEditor(
    canSendPhotos && !isEditingMedia, canSendVideos && !isEditingMedia, canSendDocuments && !isEditingMedia,
    canSendAudios && !isEditingMedia,
  );

  const isSentStoryReactionHeart = sentStoryReaction && isSameReaction(sentStoryReaction, HEART_REACTION);

  const [requestCalendar, calendar] = useSchedule(
    isInMessageList && canSchedule && canScheduleUntilOnline,
    cancelForceShowSymbolMenu,
  );
  const requestMessageSchedule = useLastCallback((callback: Parameters<typeof requestCalendar>[0]) => {
    if (isEphemeralReply) return;

    requestCalendar(callback);
  });

  useTimeout(() => {
    setIsMounted(true);
  }, MOUNT_ANIMATION_DURATION);

  useEffect(() => {
    if (isInMessageList) return;

    closeReactionPicker();
  }, [isInMessageList, storyId]);

  useEffect(() => {
    lastMessageSendTimeSecondsRef.current = undefined;
  }, [chatId]);

  useEffect(() => {
    if (isAppConfigLoaded && chatId && isReady && !isInStoryViewer && !isMonoforum) {
      loadScheduledHistory({ chatId });
    }
  }, [isReady, chatId, threadId, isInStoryViewer, isAppConfigLoaded, isMonoforum]);

  useEffect(() => {
    const isChannelWithProfiles = isChannel && chat?.areProfilesShown;
    const isChatWithSendAs = chat && isChatSuperGroup(chat)
      && Boolean(isChatPublic(chat) || chat.isLinkedInDiscussion || chat.hasGeo);
    if (!sendAsPeerIds && isReady && (isChatWithSendAs || isChannelWithProfiles)) {
      loadSendAs({ chatId });
    }
  }, [chat, chatId, isChannel, isReady, loadSendAs, sendAsPeerIds]);

  const shouldAnimateSendAsButtonRef = useRef(false);
  useSyncEffect(([prevChatId, prevSendAsPeerIds]) => {
    // We only animate send-as button if `sendAsPeerIds` was missing when opening the chat
    shouldAnimateSendAsButtonRef.current = Boolean(chatId === prevChatId && sendAsPeerIds && !prevSendAsPeerIds);
  }, [chatId, sendAsPeerIds]);

  const [attachments, setAttachments] = useState<ApiAttachment[]>([]);
  const {
    handleFiles: handleRichMediaFiles,
    handleEditMedia: handleRichMediaEdit,
    handleCloseMediaEditor: handleCloseRichMediaEditor,
    handleSaveMediaEdit: handleSaveRichMediaEdit,
    editingAttachment: editingRichMediaAttachment,
    hasBlockingMedia: hasRichMediaBlocking,
  } = useRichMedia({
    richEditor,
    chat,
    chatId,
    threadId,
    canSendPhotos: canSendPhotos && !isEditingMedia,
    canSendVideos: canSendVideos && !isEditingMedia,
    canSendDocuments: canSendDocuments && !isEditingMedia,
    canSendAudios: canSendAudios && !isEditingMedia,
    shouldSendInHighQuality: attachmentSettings.shouldSendInHighQuality,
  });
  const richMediaEditorSource = useMemo(() => (editingRichMediaAttachment ? {
    blobUrl: editingRichMediaAttachment.sourceBlobUrl ?? editingRichMediaAttachment.blobUrl,
    mimeType: editingRichMediaAttachment.mimeType,
    filename: editingRichMediaAttachment.filename,
  } : undefined), [editingRichMediaAttachment]);
  const handleApplyRichMediaEdit = useLastCallback((result: MediaEditorResult) => {
    if (result.kind === 'photo') void handleSaveRichMediaEdit(result.file, result.editState);
  });
  const hasAttachments = Boolean(attachments.length);
  const handleRichMediaSelect = useLastCallback((files: File[], shouldSendAsFile?: boolean) => {
    handleRichMediaFiles(files, undefined, undefined, shouldSendAsFile);
  });
  const richMessage = richEditor.value;
  const richMessageAsFormatted = richMessage ? getRichInputAsFormatted(richMessage) : undefined;
  const hasInputContent = richEditor.isReady ? !richEditor.isEmpty() : false;
  const hasRichOnlyContent = Boolean(hasInputContent && !richMessageAsFormatted);

  const expandRichInput = useLastCallback(() => {
    setIsRichInputExpanded({ isRichInputExpanded: true });
  });

  const collapseRichInput = useLastCallback(() => {
    if (hasRichMediaBlocking) return;

    setIsRichInputExpanded({ isRichInputExpanded: undefined });
  });

  useEffect(() => {
    if (isEditingMedia && isRichInputExpansionActive) {
      collapseRichInput();
    }
  }, [isEditingMedia, collapseRichInput, isRichInputExpansionActive]);

  const handleRichInputEscape = useLastCallback(() => {
    const editor = richEditor.editor;
    if (editor && hasActiveRichEditorTooltip(editor)) {
      return false;
    }

    collapseRichInput();
    return undefined;
  });

  const updateRichMessage = useLastCallback((value?: ApiInputRichMessage, shouldKeepHistory?: boolean) => {
    if (value && shouldKeepHistory) {
      richEditor.replaceValue(value);
    } else {
      richEditor.setValue(value);
    }
    return value;
  });

  const checkCanSendRichContent = useLastCallback(() => {
    if (hasRichMediaBlocking) {
      return false;
    }

    if (hasUnsupportedRichBlocks(richEditor.getValue())) {
      openRemoveUnsupportedDialog();
      return false;
    }

    if (!isInMessageList) {
      return true;
    }

    const currentValue = richEditor.getValue();
    if (!currentValue.blocks.length || getRichInputAsFormatted(currentValue)) {
      return true;
    }

    const approximateValue = getRichInputAsFormatted(currentValue, APPROXIMATE_RICH_INPUT_FORMAT_OPTIONS);
    if (!isValidInputRichMessage(currentValue) || !approximateValue) {
      return true;
    }

    openRemoveFormattingModal();
    return false;
  });

  const handleCloseRemoveFormattingModal = useLastCallback(() => {
    shouldFocusAfterFormattingRemovalRef.current = false;
    closeRemoveFormattingModal();
  });

  const handleRemoveFormatting = useLastCallback(() => {
    const currentValue = richEditor.getValue();
    const formattedValue = getRichInputAsFormatted(
      currentValue,
      APPROXIMATE_RICH_INPUT_FORMAT_OPTIONS,
    )!;
    richEditor.replaceValue(buildRichMessageFromFormatted(formattedValue));
    shouldFocusAfterFormattingRemovalRef.current = true;
    closeRemoveFormattingModal();
  });

  // The message is not sent right away, so the user can review what remains
  const handleRemoveUnsupported = useLastCallback(() => {
    richEditor.replaceValue(removeUnsupportedRichBlocks(richEditor.getValue()));
    closeRemoveUnsupportedDialog();
  });

  const handleRemoveFormattingModalCloseAnimationEnd = useLastCallback(() => {
    if (!shouldFocusAfterFormattingRemovalRef.current) {
      return;
    }

    shouldFocusAfterFormattingRemovalRef.current = false;
    richEditor.focus();
  });

  useEffect(() => {
    handleCloseRemoveFormattingModal();
  }, [chatId, threadId, handleCloseRemoveFormattingModal]);

  useEffect(() => {
    if (!attachments.length || !attachments) {
      updateShouldSaveAttachmentsCompression({ shouldSave: false });
    }
  }, [attachments]);

  const canUseInlineBots = !chat || isChatAdmin(chat) || !isUserRightBanned(chat, 'sendInline');

  const isSendTextBlocked = Boolean(chat) && !canSendPlainText;

  const hasWebPagePreview = !hasAttachments && canAttachEmbedLinks && !noWebPage
    && webPagePreview?.webpageType === 'full';
  const isComposerBlocked = isSendTextBlocked && !editingMessage;

  useEffect(() => {
    if (!hasWebPagePreview) {
      updateAttachmentSettings({ isInvertedMedia: undefined });
    }
  }, [hasWebPagePreview]);

  const insertTextAndUpdateCursor = useLastCallback((text: string) => {
    if (isComposerBlocked) return;

    richEditor.insertContent({ type: 'text', text });
  });

  const insertFormattedTextAndUpdateCursor = useLastCallback((
    text: ApiFormattedText, shouldPrepend = false,
  ) => {
    if (isComposerBlocked) return;

    if (!richEditor.isReady && shouldPrepend) {
      updateRichMessage(buildRichMessageFromFormatted(text));
      return;
    }

    if (!richEditor.isReady) {
      return;
    }

    richEditor.insertContent({ type: 'formattedText', text }, shouldPrepend);
  });

  const insertCustomEmojiAndUpdateCursor = useLastCallback((emoji: ApiSticker) => {
    if (isComposerBlocked) return;

    richEditor.insertContent({ type: 'customEmoji', emoji });
  });

  const {
    shouldForceCompression,
    shouldForceAsFile,
    handleAppendFiles,
    handleFileSelect,
    handleClearAttachments,
    handleSetAttachments,
  } = useAttachmentModal({
    attachments,
    setAttachments,
    chatId,
    canAttachFiles: !hasRichOnlyContent,
    canSendAudios,
    canSendVideos,
    canSendPhotos,
    canSendDocuments,
    editedMessage: editingMessage,
    shouldSendInHighQuality: attachmentSettings.shouldSendInHighQuality,
  });

  useEffect(() => {
    if (!mediaEditorMessage) return undefined;
    const media = getMessagePhoto(mediaEditorMessage) || getMessageDocumentPhoto(mediaEditorMessage)
      || getMessageVideo(mediaEditorMessage);
    if (!media) return undefined;
    const mediaHash = getMediaHash(media, 'full');
    if (!mediaHash) return undefined;
    let isCancelled = false;
    fetch(mediaHash, ApiMediaFormat.BlobUrl).then(async (blobUrl) => {
      if (isCancelled || !blobUrl) return;
      const blob = await fetchBlob(blobUrl);
      const attachment = await buildAttachment(getMediaFilename(media), blob, {
        isFromMessageMedia: true,
        shouldSendAsSpoiler: (media.mediaType !== 'document' && media.isSpoiler) || undefined,
      });
      const cover = media.mediaType === 'video' ? media.cover : undefined;
      const coverHash = cover && getMediaHash(cover, 'full');
      const coverBlobUrl = coverHash ? await fetch(coverHash, ApiMediaFormat.BlobUrl) : undefined;
      const coverBlob = coverBlobUrl ? await fetchBlob(coverBlobUrl) : undefined;
      if (isCancelled || (cover && !coverBlob)) {
        revokeAttachmentUrls(attachment);
        return;
      }

      handleSetAttachments([coverBlob
        ? buildAttachmentWithVideoCover(attachment, coverBlob, getPhotoFullDimensions(cover!))
        : attachment]);
    });

    return () => {
      isCancelled = true;
    };
  }, [mediaEditorMessage, handleSetAttachments]);

  const [isBotCommandMenuOpen, openBotCommandMenu, closeBotCommandMenu] = useFlag();
  const [isSymbolMenuOpen, openSymbolMenu, closeSymbolMenu] = useFlag();
  const [isSymbolMenuLoaded, markSymbolMenuLoaded] = useFlag();
  const [isSendAsMenuOpen, openSendAsMenu, closeSendAsMenu] = useFlag();
  const [isHoverDisabled, disableHover, enableHover] = useFlag();

  const {
    startRecordingVoice,
    stopRecordingVoice,
    cancelRecordingVoice,
    pauseRecordingVoice,
    resumeRecordingVoice,
    toggleViewOnceEnabled,
    subscribeToRecordingPeaks,
    activeVoiceRecording,
    isRecordingPaused,
    recordButtonRef: mainButtonRef,
    isViewOnceEnabled,
    setIsViewOnceEnabled,
  } = useVoiceRecording();

  const {
    startRecordingVideo,
    stopRecordingVideo,
    finishRecordingVideo,
    discardRecordingVideo,
    pauseRecordingVideo,
    resumeRecordingVideo,
    activeVideoRecording,
    previewStream,
    isVideoRecordingStarting,
    isVideoRecordingReady,
    isVideoRecordingPaused,
    isRecordingFinished,
    getProgress,
    subscribeToVideoRecordingPeaks,
  } = useVideoRecording();

  const activeRecording = activeVoiceRecording || activeVideoRecording;
  const [isEmbeddedMessageOpen, setIsEmbeddedMessageOpen] = useState(false);

  const hasBotKeyboard = Boolean(botKeyboardMessageId) && isInMessageList && messageListType === 'thread';
  const canShowBotKeyboard = hasBotKeyboard && !editingMessage && !isSelectModeActive && !activeRecording;
  const canShowSymbolMenu = (!isComposerBlocked || canSendGifs || canSendStickers)
    && !isAccountFrozen;
  const isSymbolMenuShown = canShowSymbolMenu && (isSymbolMenuOpen || isSymbolMenuForced) && isSymbolMenuLoaded;
  const isSymbolMenuInKeyboardSlot = Boolean(isMobile && hasBotKeyboard);
  const isBotKeyboardSuppressed = (IS_TOUCH_ENV && isInputHasFocus) || hasInputContent
    || Boolean(isMobile && (isSymbolMenuShown || hasActiveMiddleSearch));
  const isBotKeyboardShown = canShowBotKeyboard && botKeyboardMessageId !== hiddenBotKeyboardId
    && !isBotKeyboardSuppressed;
  const isBotKeyboardOpen = isBotKeyboardShown && !isRichInputExpansionActive;
  const isKeyboardSlotOpen = isBotKeyboardShown || (isSymbolMenuInKeyboardSlot && isSymbolMenuShown);

  const hideBotKeyboard = useLastCallback(() => {
    setHiddenBotKeyboardId({ chatId, threadId, messageId: botKeyboardMessageId });
  });

  const showBotKeyboard = useLastCallback(() => {
    setHiddenBotKeyboardId({ chatId, threadId, messageId: undefined });
  });

  useEffectWithPrevDeps(([prevHasInputContent, wasBotKeyboardOpen, prevChatId, prevThreadId]) => {
    if (!hasInputContent || prevHasInputContent || !wasBotKeyboardOpen) return;
    if (chatId !== prevChatId || threadId !== prevThreadId) return;

    hideBotKeyboard();
  }, [hasInputContent, isBotKeyboardOpen, chatId, threadId]);

  useEffect(() => {
    if (!activeRecording) return;
    const input = document.getElementById(editableInputId);
    if (input && document.activeElement === input) {
      input.blur();
    }
  }, [activeRecording, editableInputId]);

  const shouldSendRecordingStatus = isForCurrentMessageList && !isInStoryViewer;
  useInterval(() => {
    sendMessageAction({ type: 'recordAudio' });
  }, shouldSendRecordingStatus ? activeVoiceRecording && SEND_MESSAGE_ACTION_INTERVAL : undefined);
  useInterval(() => {
    sendMessageAction({ type: 'recordRound' });
  }, shouldSendRecordingStatus ? activeVideoRecording && SEND_MESSAGE_ACTION_INTERVAL : undefined);

  useEffect(() => {
    if (!isForCurrentMessageList || isInStoryViewer) return;
    if (!activeVoiceRecording && !activeVideoRecording) {
      sendMessageAction({ type: 'cancel' });
    }
  }, [activeVoiceRecording, activeVideoRecording, isForCurrentMessageList, isInStoryViewer, sendMessageAction]);

  useEffect(() => {
    return () => {
      discardRecordingVideo();
    };
  }, [chatId, threadId, discardRecordingVideo]);

  const canSendTyping = isForCurrentMessageList && !isInStoryViewer
    && !isRichInputExpansionActive && !hasRichOnlyContent && hasInputContent && !editingMessage;
  useEffectWithPrevDeps(([prevRichMessage]) => {
    if (canSendTyping && richMessage !== prevRichMessage) {
      sendMessageAction({ type: 'typing' });
    }
  }, [richMessage, canSendTyping, sendMessageAction]);

  const isAdmin = chat && isChatAdmin(chat);

  const insertMention = useLastCallback((peer: ApiPeer, forceFocus = false) => {
    const username = getMainUsername(peer);
    const text = username ? `@${username}` : getPeerTitle(lang, peer);
    if (!text) {
      return;
    }

    if (forceFocus) {
      richEditor.focus();
    }
    richEditor.insertContent([{
      type: 'mention',
      userId: peer.id,
      username,
      text,
    }, { type: 'text', text: ' ' }]);
  });

  useEffect(() => {
    if (!insertingPeerIdMention) return;
    const peer = selectPeer(getGlobal(), insertingPeerIdMention);
    if (peer) {
      insertMention(peer, true);
    }
    updateInsertingPeerIdMention({ peerId: undefined });
  }, [insertingPeerIdMention, insertMention]);

  useDraft({
    draft,
    chatId,
    threadId,
    richMessage,
    replaceRichMessage: updateRichMessage,
    editedMessage: editingMessage,
    isDisabled: isInStoryViewer || Boolean(requestedDraft) || isMonoforum,
    hasUnresolvedMedia: hasRichMediaBlocking,
  });

  useLoadLinkPreview({
    chatId,
    threadId,
    richMessage,
  });

  const resetComposer = useLastCallback((shouldPreserveInput = false, shouldSkipCollapseLatch = false) => {
    if (!shouldPreserveInput) {
      if (!shouldSkipCollapseLatch && !isKeyboardSlotOpen) {
        const footer = inputRef.current?.closest<HTMLElement>('.middle-column-footer');
        const scroller = footer?.parentElement?.querySelector<HTMLElement>(':scope > .MessageList');
        if (scroller) {
          armSendCollapseReserve(scroller);
        }
      }

      updateRichMessage(undefined);
    }

    setAttachments(MEMO_EMPTY_ARRAY);
    collapseRichInput();

    if (isMobile) {
      // @optimization
      setTimeout(() => closeSymbolMenu(), SENDING_ANIMATION_DURATION);
    } else {
      closeSymbolMenu();
    }
  });

  const validateTextLength = useLastCallback((text: string, isAttachmentModal?: boolean) => {
    const maxLength = isAttachmentModal ? LIMITS.captionLength : LIMITS.messageLength;
    const textLength = getUtf8Length(text);
    if (textLength > maxLength) {
      const extraLength = textLength - maxLength;
      showNotification({
        message: {
          key: 'ErrorMessageTooLong',
          variables: {
            count: extraLength,
          },
          options: {
            pluralValue: extraLength,
          },
        },
      });

      return false;
    }
    return true;
  });

  const validateRichMessageLimits = useLastCallback((value: ApiInputRichMessage) => {
    const usage = getRichMessageUsage(value);

    if (usage.textLength > richMessageLengthLimit) {
      const extraLength = usage.textLength - richMessageLengthLimit;
      showNotification({
        message: {
          key: 'ErrorMessageTooLong',
          variables: { count: extraLength },
          options: { pluralValue: extraLength },
        },
      });
      return false;
    }

    if (usage.blockCount > richMessageMaxBlocks) {
      const extraCount = usage.blockCount - richMessageMaxBlocks;
      showNotification({
        message: {
          key: 'ErrorRichMessageTooManyBlocks',
          variables: { count: extraCount },
          options: { pluralValue: extraCount },
        },
      });
      return false;
    }

    if (usage.maxDepth > richMessageMaxDepth) {
      showNotification({
        message: {
          key: 'ErrorRichMessageTooDeep',
          variables: { count: richMessageMaxDepth },
        },
      });
      return false;
    }

    if (usage.mediaCount > richMessageMaxMedia) {
      const extraCount = usage.mediaCount - richMessageMaxMedia;
      showNotification({
        message: {
          key: 'ErrorRichMessageTooManyMedia',
          variables: { count: extraCount },
          options: { pluralValue: extraCount },
        },
      });
      return false;
    }

    if (usage.maxTableColumnCount > richMessageMaxTableColumns) {
      showNotification({
        message: {
          key: 'ErrorRichMessageTableTooWide',
          variables: { count: richMessageMaxTableColumns },
        },
      });
      return false;
    }

    return true;
  });

  const [handleEditComplete, handleEditCancel, shouldForceShowEditing] = useEditing(
    richMessage,
    updateRichMessage,
    editingMessage,
    resetComposer,
    validateTextLength,
    chatId,
    threadId,
    messageListType,
    draft,
    editingDraft,
  );

  // Handle chat change (should be placed after `useDraft` and `useEditing`)
  const resetComposerRef = useStateRef(resetComposer);
  const cancelRecordingVoiceRef = useStateRef(cancelRecordingVoice);
  useLayoutEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
      cancelRecordingVoiceRef.current();
      // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
      resetComposerRef.current(false, true);
    };
  }, [chatId, threadId, resetComposerRef, cancelRecordingVoiceRef]);

  const isStoryReactionPickerOpen = isInStoryViewer && Boolean(isReactionPickerOpen);
  const isComposerEngaged = isInputHasFocus || isSymbolMenuOpen || isSymbolMenuForced || isBotKeyboardOpen
    || isSendAsMenuOpen || isStoryReactionPickerOpen || Boolean(activeRecording) || attachments.length > 0;
  const isComposerActive = isComposerEngaged || isAttachMenuOpen;

  const mainButtonState = useDerivedState(() => {
    if (!isComposerEngaged && onForward && !(hasInputContent && !hasAttachments)) {
      return MainButtonState.Forward;
    }

    if (editingMessage && shouldForceShowEditing) {
      return MainButtonState.Edit;
    }

    if (isInMessageList && stoppableTypingDraftId && !editingMessage && !isInScheduledList && !isForwarding
      && !activeVoiceRecording && !activeVideoRecording) {
      return MainButtonState.Stop;
    }

    if ((IS_VOICE_RECORDING_SUPPORTED || IS_VIDEO_RECORDING_SUPPORTED)
      && !activeVoiceRecording && !activeVideoRecording && !isForwarding && !isRichInputExpansionActive
      && !(hasInputContent && !hasAttachments)) {
      return MainButtonState.Record;
    }

    if (isInScheduledList) {
      return MainButtonState.Schedule;
    }

    return MainButtonState.Send;
  }, [
    activeVoiceRecording, activeVideoRecording, editingMessage, hasAttachments, isForwarding, isComposerEngaged,
    onForward, shouldForceShowEditing, isInScheduledList, hasInputContent, isRichInputExpansionActive,
    isInMessageList, stoppableTypingDraftId,
  ]);
  const canShowCustomSendMenu = !isInScheduledList;

  const {
    isContextMenuOpen: isCustomSendMenuOpen,
    handleContextMenu,
    handleContextMenuClose,
    handleContextMenuHide,
  } = useContextMenuHandlers(mainButtonRef, !(mainButtonState === MainButtonState.Send && canShowCustomSendMenu));

  const canSwitchRecordMode = CAN_SWITCH_RECORD_MODE
    && canSendVoiceByPrivacy && canSendVoices && canSendRoundVideos;

  const {
    isContextMenuOpen: isRecordModeMenuOpen,
    handleContextMenu: handleRecordModeContextMenu,
    handleContextMenuClose: handleRecordModeMenuClose,
    handleContextMenuHide: handleRecordModeMenuHide,
  } = useContextMenuHandlers(
    mainButtonRef, !(mainButtonState === MainButtonState.Record && canSwitchRecordMode),
  );

  const handleSelectRecordMode = useLastCallback((mode: RecordMode) => {
    setSettingOption({ lastRecordMessageMode: mode });
    handleRecordModeMenuClose();
  });

  const {
    contextMenuAnchor: storyReactionPickerAnchor,
    handleContextMenu: handleStoryPickerContextMenu,
    handleBeforeContextMenu: handleBeforeStoryPickerContextMenu,
    handleContextMenuHide: handleStoryPickerContextMenuHide,
  } = useContextMenuHandlers(storyReactionRef, !isInStoryViewer);

  useEffect(() => {
    if (isReactionPickerOpen) return;

    if (storyReactionPickerAnchor) {
      openStoryReactionPicker({
        peerId: chatId,
        storyId: storyId!,
        position: storyReactionPickerAnchor,
      });
      handleStoryPickerContextMenuHide();
    }
  }, [chatId, handleStoryPickerContextMenuHide, isReactionPickerOpen, storyId, storyReactionPickerAnchor]);

  const { className: peerColorClass, style: peerColorStyle } = usePeerColor({
    peer: sendAsPeer || currentUser,
  });

  const hasGifFromPicker = attachments.some((a) => a.gif);

  const resolveFilePasteTarget = useLastCallback(() => {
    if (isRichInputExpansionActive) {
      return 'richMedia';
    }

    const currentRichMessage = richEditor.getValue();
    const hasUnrepresentableRichContent = Boolean(
      currentRichMessage.blocks.length && !getRichInputAsFormatted(currentRichMessage),
    );

    return hasUnrepresentableRichContent ? 'none' : 'attachmentModal';
  });
  const getRichMediaPastePosition = useLastCallback(() => richEditor.editor?.state.selection.from);

  useClipboardPaste(
    isForCurrentMessageList || isInStoryViewer,
    insertFormattedTextAndUpdateCursor,
    handleSetAttachments,
    editingMessage,
    resolveFilePasteTarget,
    !attachments.length,
    hasGifFromPicker,
    handleRichMediaFiles,
    getRichMediaPastePosition,
  );

  const handleEmbeddedClear = useLastCallback(() => {
    if (hasRichMediaBlocking) return;

    if (editingMessage) {
      handleEditCancel();
    }
  });

  const checkSlowMode = useLastCallback(() => {
    if (slowMode && !isAdmin) {
      const messageInput = document.querySelector<HTMLDivElement>(editableInputCssSelector);

      const nowSeconds = getServerTime();
      const secondsSinceLastMessage = lastMessageSendTimeSecondsRef.current
        && Math.floor(nowSeconds - lastMessageSendTimeSecondsRef.current);
      const nextSendDateNotReached = slowMode.nextSendDate && slowMode.nextSendDate > nowSeconds;

      if (
        (secondsSinceLastMessage !== undefined && secondsSinceLastMessage < slowMode.seconds)
        || nextSendDateNotReached
      ) {
        const secondsRemaining = nextSendDateNotReached
          ? slowMode.nextSendDate! - nowSeconds
          : slowMode.seconds - secondsSinceLastMessage!;

        showDialog({
          data: {
            type: 'localized',
            text: {
              key: 'SlowModeHint',
              variables: {
                time: formatMediaDuration(secondsRemaining),
              },
            },
          },
        });

        messageInput?.blur();

        return false;
      }
    }
    return true;
  });

  const validateEphemeralReply = useLastCallback(() => {
    if (
      draft?.replyInfo?.type === 'ephemeral'
      && !selectEphemeralMessage(getGlobal(), chatId, draft.replyInfo.replyToMsgId)
    ) {
      showNotification({ message: { key: 'EphemeralReplyUnavailable' } });
      return false;
    }

    return true;
  });

  const canSendAttachments = (attachmentsToSend: ApiAttachment[]): boolean => {
    if (!currentMessageList && !storyId) {
      return false;
    }
    if (attachmentsToSend.some(({ isPreparing }) => isPreparing)) {
      return false;
    }

    const currentRichMessage = richEditor.getValue();
    if (hasUnsupportedRichBlocks(currentRichMessage)) {
      openRemoveUnsupportedDialog();
      return false;
    }

    const formattedRichMessage = currentRichMessage.blocks.length
      ? getRichInputAsFormatted(currentRichMessage) : undefined;
    if (currentRichMessage.blocks.length && !formattedRichMessage) {
      return false;
    }

    const { text } = formattedRichMessage || { text: '' };
    if (!text && !attachmentsToSend.length) {
      return false;
    }
    if (!validateTextLength(text, true)) return false;
    if (!checkSlowMode()) return false;

    return true;
  };

  const sendAttachments = useLastCallback(({
    attachments: attachmentsToSend,
    sendCompressed = attachmentSettings.shouldCompress,
    sendGrouped = attachmentSettings.shouldSendGrouped,
    isSilent,
    scheduledAt,
    isInvertedMedia,
  }: {
    attachments: ApiAttachment[];
    sendCompressed?: boolean;
    sendGrouped?: boolean;
    isSilent?: boolean;
    scheduledAt?: number;
    isInvertedMedia?: true;
  }) => {
    if (!validateEphemeralReply()) return;

    if (!currentMessageList && !storyId) {
      return;
    }
    isSilent = isSilent || isSilentPosting;

    const currentRichMessage = richEditor.getValue();
    const formattedRichMessage = currentRichMessage.blocks.length
      ? getRichInputAsFormatted(currentRichMessage) : undefined;
    const { text, entities } = formattedRichMessage || { text: '' };

    isInvertedMedia = text && sendCompressed && sendGrouped ? isInvertedMedia : undefined;

    if (editingMessage) {
      editMessage({
        messageList: currentMessageList,
        text,
        entities,
        attachments: prepareAttachmentsToSend(attachmentsToSend, sendCompressed),
      });
    } else {
      sendMessage({
        messageList: currentMessageList,
        text,
        entities,
        scheduledAt,
        isSilent,
        shouldUpdateStickerSetOrder,
        attachments: prepareAttachmentsToSend(attachmentsToSend, sendCompressed),
        shouldGroupMessages: sendGrouped,
        isInvertedMedia,
      });
    }

    lastMessageSendTimeSecondsRef.current = getServerTime();

    clearDraft({ chatId, threadId, isLocalOnly: true });

    const shouldSkipCollapseLatch = Boolean(editingMessage) || Boolean(scheduledAt && !isInScheduledList);

    // Wait until message animation starts
    requestMeasure(() => {
      resetComposer(false, shouldSkipCollapseLatch);
    });
  });

  const handleSendAttachmentsFromModal = useLastCallback((
    sendCompressed: boolean,
    sendGrouped: boolean,
    isInvertedMedia?: true,
  ) => {
    if (canSendAttachments(attachments)) {
      if (editingMessage) {
        sendAttachments({
          attachments,
          sendCompressed,
          sendGrouped,
          isInvertedMedia,
        });
        return;
      }

      sendAttachments({
        attachments,
        sendCompressed,
        sendGrouped,
        isInvertedMedia,
      });
    }
  });

  const handleSendAttachments = useLastCallback((
    sendCompressed: boolean,
    sendGrouped: boolean,
    isSilent?: boolean,
    scheduledAt?: number,
    isInvertedMedia?: true,
  ) => {
    if (canSendAttachments(attachments)) {
      sendAttachments({
        attachments,
        sendCompressed,
        sendGrouped,
        isSilent,
        scheduledAt,
        isInvertedMedia,
      });
    }
  });

  const handleSendCore = useLastCallback(
    (
      currentAttachments: ApiAttachment[],
      isSilent = false,
      scheduledAt?: number,
      shouldSkipWebPagePreview?: boolean,
    ) => {
      const richEditorValue = richEditor.getValue();
      const currentRichMessage = richEditorValue.blocks.length ? richEditorValue : undefined;
      const formattedRichMessage = currentRichMessage ? getRichInputAsFormatted(currentRichMessage) : undefined;
      const richMessageToSend = hasRichOnlyContent ? currentRichMessage : undefined;
      const { text, entities } = richMessageToSend
        ? { text: '' }
        : formattedRichMessage || { text: '' };

      if (currentAttachments.length) {
        if (canSendAttachments(currentAttachments)) {
          sendAttachments({
            attachments: currentAttachments,
            scheduledAt,
            isSilent,
          });
        }
        return;
      }

      if (richMessageToSend) {
        if (
          !currentMessageList
          || !isValidInputRichMessage(richMessageToSend)
          || !validateRichMessageLimits(richMessageToSend)
        ) {
          return;
        }
        if (!checkSlowMode()) return;

        if (editingMessage) {
          editMessage({
            messageList: currentMessageList,
            text: '',
            richMessage: richMessageToSend,
          });
        } else {
          sendMessage({
            messageList: currentMessageList,
            richMessage: richMessageToSend,
            scheduledAt,
            isSilent,
            shouldUpdateStickerSetOrder,
          });
        }

        lastMessageSendTimeSecondsRef.current = getServerTime();
        clearDraft({
          chatId, threadId, isLocalOnly: true, shouldKeepReply: isForwarding,
        });

        const shouldSkipCollapseLatch = Boolean(editingMessage) || Boolean(scheduledAt && !isInScheduledList);

        requestMeasure(() => {
          resetComposer(false, shouldSkipCollapseLatch);
        });
        return;
      }

      if (!text && !isForwarding) {
        return;
      }

      if (!validateTextLength(text)) return;

      const messageInput = document.querySelector<HTMLDivElement>(editableInputCssSelector);

      if (text || isForwarding) {
        if (!checkSlowMode()) return;

        const shouldUseWebPagePreview = hasWebPagePreview && !shouldSkipWebPagePreview;
        const isInvertedMedia = shouldUseWebPagePreview ? attachmentSettings.isInvertedMedia : undefined;

        sendMessage({
          messageList: currentMessageList,
          text,
          entities,
          scheduledAt,
          isSilent,
          shouldUpdateStickerSetOrder,
          isInvertedMedia,
          webPageMediaSize: shouldSkipWebPagePreview ? undefined : attachmentSettings.webPageMediaSize,
          webPageUrl: shouldUseWebPagePreview ? webPagePreview.url : undefined,
        });
      }

      lastMessageSendTimeSecondsRef.current = getServerTime();
      clearDraft({
        chatId, threadId, isLocalOnly: true, shouldKeepReply: isForwarding,
      });

      if (IS_IOS && messageInput && messageInput === document.activeElement) {
        applyIosAutoCapitalizationFix(messageInput);
      }

      // Wait until message animation starts
      requestMeasure(() => {
        resetComposer(false, Boolean(scheduledAt && !isInScheduledList));
      });
    },
  );

  const handleSend = useLastCallback(async (
    isSilent = false,
    scheduledAt?: number,
    shouldSkipWebPagePreview?: boolean,
  ) => {
    if (!validateEphemeralReply()) return;

    if (!currentMessageList && !storyId) {
      return;
    }

    isSilent = isSilent || isSilentPosting;

    let currentAttachments = attachments;

    if (activeVoiceRecording) {
      const record = await stopRecordingVoice();
      const ttlSeconds = isViewOnceEnabled ? ONE_TIME_MEDIA_TTL_SECONDS : undefined;
      if (record) {
        const { blob, duration, waveform } = record;
        currentAttachments = [await buildAttachment(
          VOICE_RECORDING_FILENAME,
          blob,
          { voice: { duration, waveform }, ttlSeconds },
        )];
      }
    }

    if (activeVideoRecording) {
      const record = await stopRecordingVideo();
      const ttlSeconds = isViewOnceEnabled ? ONE_TIME_MEDIA_TTL_SECONDS : undefined;
      if (record && record.durationMs >= MIN_ROUND_VIDEO_RECORDING_TIME) {
        const { blob, duration } = record;
        currentAttachments = [await prepareAttachment(await buildAttachment(
          VIDEO_RECORDING_FILENAME,
          blob,
          {
            isRoundVideo: true,
            ttlSeconds,
            quick: { width: ROUND_VIDEO_RECORDING_SIZE, height: ROUND_VIDEO_RECORDING_SIZE, duration },
          },
        ))];
      }
    }

    handleSendCore(currentAttachments, isSilent, scheduledAt, shouldSkipWebPagePreview);
  });

  const handleSendWithConfirmation = useLastCallback((
    isSilent = false,
    scheduledAt?: number,
    shouldSkipWebPagePreview?: boolean,
  ) => {
    if (!checkCanSendRichContent()) {
      return;
    }

    handleSend(
      isSilent, scheduledAt, shouldSkipWebPagePreview,
    );
  });

  const handleOpenRichInput = useLastCallback(() => {
    if (!isInMessageList || isEditingMedia) {
      return;
    }

    closeSymbolMenu();
    expandRichInput();
  });

  const handleClickBotMenu = useLastCallback(() => {
    if (botMenuButton?.type !== 'webApp') {
      return;
    }

    const parsedLink = tryParseDeepLink(botMenuButton.url);

    if (parsedLink?.type === 'publicUsernameOrBotLink' && parsedLink.appName) {
      processDeepLink(botMenuButton.url);
    } else {
      callAttachBot({
        chatId, url: botMenuButton.url, threadId,
      });
    }
  });

  const handleActivateBotCommandMenu = useLastCallback(() => {
    closeSymbolMenu();
    openBotCommandMenu();
  });

  const handleMessageSchedule = useLastCallback((
    args: ScheduledMessageArgs,
    scheduledAt: number,
    messageList: MessageList,
  ) => {
    if (!validateEphemeralReply() || isEphemeralReply) return;

    if (args && 'queryId' in args) {
      const { id, queryId, isSilent } = args;
      sendInlineBotResult({
        id,
        chatId,
        threadId,
        queryId,
        scheduledAt,
        isSilent: isSilent || isSilentPosting,
      });
      return;
    }

    const { isSilent, ...restArgs } = args || {};

    if (!args || Object.keys(restArgs).length === 0) {
      void handleSend(Boolean(isSilent), scheduledAt);
    } else if (args.sendCompressed !== undefined || args.sendGrouped !== undefined) {
      const { sendCompressed = false, sendGrouped = false, isInvertedMedia } = args;
      void handleSendAttachments(sendCompressed, sendGrouped, isSilent, scheduledAt, isInvertedMedia);
    } else {
      sendMessage({
        ...args,
        messageList,
        scheduledAt,
      });
    }
  });

  useEffectWithPrevDeps(([prevContentToBeScheduled]) => {
    if (currentMessageList && contentToBeScheduled && contentToBeScheduled !== prevContentToBeScheduled) {
      requestMessageSchedule((scheduledAt) => {
        handleMessageSchedule(contentToBeScheduled, scheduledAt, currentMessageList);
      });
    }
  }, [contentToBeScheduled, currentMessageList, handleMessageSchedule, requestMessageSchedule]);

  useEffect(() => {
    if (requestedDraft) {
      updateRichMessage(undefined);
      insertFormattedTextAndUpdateCursor(requestedDraft, true);
      resetOpenChatWithDraft();

      requestNextMutation(() => {
        const messageInput = document.getElementById(editableInputId)!;
        focusEditableElement(messageInput, true);
      });
    }
  }, [editableInputId, insertFormattedTextAndUpdateCursor, requestedDraft, resetOpenChatWithDraft, updateRichMessage]);

  useEffect(() => {
    if (requestedDraftFiles?.length) {
      void handleFileSelect(requestedDraftFiles);
      resetOpenChatWithDraft();
    }
  }, [handleFileSelect, requestedDraftFiles, resetOpenChatWithDraft]);

  const applyRichInputMediaRequest = useLastCallback((request: NonNullable<TabState['requestedRichInputMedia']>) => {
    if (
      request.chatId !== chatId
      || request.threadId !== threadId
      || request.messageListType !== messageListType
    ) return;
    if (!isRichInputExpansionActive || !richEditor.editor) return;

    if (request.files) {
      handleRichMediaSelect(request.files);
      return;
    }
    if (!request.audio) return;

    const isInserted = richEditor.insertMedia(
      [{ type: 'audio', media: request.audio, caption: EMPTY_RICH_MEDIA_CAPTION }],
      richEditor.editor.state.selection.from,
    );
    if (!isInserted) {
      showNotification({ message: lang('RichMediaSkippedFiles', { count: 1 }, { pluralValue: 1 }) });
    }
  });

  useEffect(() => {
    if (!requestedRichInputMedia) return;

    resetRichInputMediaRequest();
    applyRichInputMediaRequest(requestedRichInputMedia);
  }, [applyRichInputMediaRequest, requestedRichInputMedia, resetRichInputMediaRequest]);

  useEffect(() => {
    if (requestedDraftFiles?.length) {
      updateShouldSaveAttachmentsCompression({ shouldSave: true });
      applyDefaultAttachmentsCompression();
    } else {
      updateShouldSaveAttachmentsCompression({ shouldSave: false });
    }
  }, [requestedDraftFiles, updateShouldSaveAttachmentsCompression, applyDefaultAttachmentsCompression]);

  const handleCustomEmojiSelect = useLastCallback((emoji: ApiSticker) => {
    insertCustomEmojiAndUpdateCursor(emoji);
  });

  const handleGifSelect = useLastCallback((gif: ApiVideo, isSilent?: boolean, isScheduleRequested?: boolean) => {
    if (!validateEphemeralReply() || (isEphemeralReply && isScheduleRequested)) return;

    if (!currentMessageList && !storyId) {
      return;
    }

    isSilent = isSilent || isSilentPosting;

    if (isInScheduledList || isScheduleRequested) {
      forceShowSymbolMenu();
      requestMessageSchedule((scheduledAt) => {
        cancelForceShowSymbolMenu();
        handleMessageSchedule(
          { gif, isSilent },
          scheduledAt,
          currentMessageList!,
        );
        requestMeasure(() => {
          resetComposer(true);
        });
      });
    } else {
      sendMessage({ messageList: currentMessageList, gif, isSilent });
      requestMeasure(() => {
        resetComposer(true);
      });
    }

    clearDraft({ chatId, threadId, isLocalOnly: true });
  });

  const handleGifAddCaption = useLastCallback((gif: ApiVideo) => {
    handleSetAttachments([buildGifAttachment(gif)]);
    closeSymbolMenu();
  });

  const handleStickerSelect = useLastCallback((
    sticker: ApiSticker,
    isSilent?: boolean,
    isScheduleRequested?: boolean,
    shouldPreserveInput = false,
    canUpdateStickerSetsOrder?: boolean,
  ) => {
    if (!validateEphemeralReply() || (isEphemeralReply && isScheduleRequested)) return;

    if (!currentMessageList && !storyId) {
      return;
    }

    isSilent = isSilent || isSilentPosting;

    if (isInScheduledList || isScheduleRequested) {
      forceShowSymbolMenu();
      requestMessageSchedule((scheduledAt) => {
        cancelForceShowSymbolMenu();
        handleMessageSchedule(
          { sticker, isSilent },
          scheduledAt,
          currentMessageList!,
        );
        requestMeasure(() => {
          resetComposer(shouldPreserveInput, !isInScheduledList);
        });
      });
    } else {
      sendMessage(
        {
          messageList: currentMessageList,
          sticker,
          isSilent,
          shouldUpdateStickerSetOrder: shouldUpdateStickerSetOrder && canUpdateStickerSetsOrder,
        },
      );
      clearDraft({ chatId, threadId, isLocalOnly: true });

      requestMeasure(() => {
        resetComposer(shouldPreserveInput);
      });
    }
  });

  const handleInlineBotSelect = useLastCallback((
    inlineBotId: string,
    inlineResult: ApiBotInlineResult | ApiBotInlineMediaResult, isSilent?: boolean, isScheduleRequested?: boolean,
  ) => {
    if (!validateEphemeralReply() || isEphemeralReply) return;

    if (!currentMessageList && !storyId) {
      return;
    }

    isSilent = isSilent || isSilentPosting;

    if (isInScheduledList || isScheduleRequested) {
      requestMessageSchedule((scheduledAt) => {
        handleMessageSchedule(
          {
            id: inlineResult.id,
            queryId: inlineResult.queryId,
            isSilent,
          },
          scheduledAt,
          currentMessageList!,
        );
      });
    } else {
      sendInlineBotResult(
        {
          id: inlineResult.id,
          queryId: inlineResult.queryId,
          threadId,
          chatId,
          isSilent,
        },
      );
    }

    const messageInput = document.querySelector<HTMLDivElement>(editableInputCssSelector);
    if (IS_IOS && messageInput && messageInput === document.activeElement) {
      applyIosAutoCapitalizationFix(messageInput);
    }

    clearDraft({ chatId, threadId, isLocalOnly: true });
    requestMeasure(() => {
      resetComposer(false, Boolean(isScheduleRequested && !isInScheduledList));
    });
  });

  const handleBotCommandSelect = useLastCallback(() => {
    clearDraft({ chatId, threadId, isLocalOnly: true });
    requestMeasure(() => {
      resetComposer();
    });
  });

  const getTooltipBoundary = useLastCallback(() => composerRef.current);
  const getRichEditorTooltipContext = useLastCallback(() => ({
    chatId,
    threadId,
    currentUserId,
    currentUser,
    groupChatMembers,
    topInlineBotIds: canUseInlineBots ? topInlineBotIds : undefined,
    topGuestBotIds,
    recentEmojiIds: recentEmojis,
    baseEmojiKeywords,
    emojiKeywords,
    inlineBots,
    botCommands,
    chatBotCommands,
    isSavedMessages: isChatWithSelf,
    isInScheduledList,
    isCurrentUserPremium,
    canSendGifs,
  }));
  const getIsEmojiTooltipEnabled = useLastCallback(() => Boolean(
    isReady && isOnActiveTab && (isInStoryViewer || isForCurrentMessageList)
    && shouldSuggestStickers && !hasAttachments,
  ));
  const getIsCustomEmojiTooltipEnabled = useLastCallback(() => Boolean(
    isReady && isOnActiveTab && (isInStoryViewer || isForCurrentMessageList)
    && shouldSuggestCustomEmoji && !hasAttachments,
  ));
  const getIsStickerTooltipEnabled = useLastCallback(() => Boolean(
    isReady && isOnActiveTab && (isInStoryViewer || isForCurrentMessageList)
    && shouldSuggestStickers && canSendStickers && !hasAttachments,
  ));
  const getIsMentionTooltipEnabled = useLastCallback(() => Boolean(
    isInMessageList && isReady && isForCurrentMessageList && !hasAttachments,
  ));
  const getIsInlineBotTooltipEnabled = useLastCallback(() => Boolean(
    canUseInlineBots && isInMessageList && isReady && isForCurrentMessageList && !hasAttachments,
  ));
  const getIsCommandTooltipEnabled = useLastCallback(() => Boolean(
    isInMessageList
    && isReady
    && isForCurrentMessageList
    && (
      (botCommands && botCommands.length)
      || chatBotCommands?.length
    ),
  ));
  const getIsFormatterEnabled = useLastCallback(() => Boolean(
    isReady && isOnActiveTab && (isInStoryViewer || isForCurrentMessageList) && !hasAttachments,
  ));
  const richEditorTooltips = useMemo<RichEditorTooltipsConfig>(() => ({
    emoji: {
      isEnabled: getIsEmojiTooltipEnabled,
      addRecentEmoji,
      addRecentCustomEmoji,
    },
    customEmoji: {
      isEnabled: getIsCustomEmojiTooltipEnabled,
      addRecentCustomEmoji,
    },
    sticker: {
      isEnabled: getIsStickerTooltipEnabled,
      onSelect: handleStickerSelect,
    },
    mention: isInMessageList ? { isEnabled: getIsMentionTooltipEnabled } : undefined,
    command: isInMessageList ? {
      isEnabled: getIsCommandTooltipEnabled,
      onSelect: handleBotCommandSelect,
    } : undefined,
    inlineBot: isInMessageList ? {
      isEnabled: getIsInlineBotTooltipEnabled,
      onSelect: handleInlineBotSelect,
    } : undefined,
    formatter: {
      isEnabled: getIsFormatterEnabled,
      capabilities: 'full',
    },
    getTooltipBoundary,
    getContext: getRichEditorTooltipContext,
  }), [
    addRecentCustomEmoji, addRecentEmoji, getIsCommandTooltipEnabled, getIsCustomEmojiTooltipEnabled,
    getIsEmojiTooltipEnabled, getIsFormatterEnabled, getIsInlineBotTooltipEnabled,
    getIsMentionTooltipEnabled, getIsStickerTooltipEnabled, getRichEditorTooltipContext,
    getTooltipBoundary, handleBotCommandSelect, handleInlineBotSelect, handleStickerSelect,
    isInMessageList,
  ]);

  const sendSilent = useLastCallback((additionalArgs?: ScheduledMessageArgs) => {
    if (isInScheduledList) {
      requestMessageSchedule((scheduledAt) => {
        handleMessageSchedule(
          { ...additionalArgs, isSilent: true },
          scheduledAt,
          currentMessageList!,
        );
      });
    } else if (additionalArgs && ('sendCompressed' in additionalArgs || 'sendGrouped' in additionalArgs)) {
      const { sendCompressed = false, sendGrouped = false, isInvertedMedia } = additionalArgs;
      void handleSendAttachments(sendCompressed, sendGrouped, true, undefined, isInvertedMedia);
    } else {
      void handleSend(true);
    }
  });

  const handleSendAsMenuOpen = useLastCallback(() => {
    const messageInput = document.querySelector<HTMLDivElement>(editableInputCssSelector);

    if (!isMobile || messageInput !== document.activeElement) {
      closeBotCommandMenu();
      closeSymbolMenu();
      openSendAsMenu();
      return;
    }

    messageInput?.blur();
    setTimeout(() => {
      closeBotCommandMenu();
      closeSymbolMenu();
      openSendAsMenu();
    }, MOBILE_KEYBOARD_HIDE_DELAY_MS);
  });

  const handleToggleBotKeyboard = useLastCallback(() => {
    if (isBotKeyboardOpen) {
      hideBotKeyboard();
      return;
    }

    if (IS_TOUCH_ENV) {
      document.querySelector<HTMLDivElement>(editableInputCssSelector)?.blur();
    }
    closeSymbolMenu();
    showBotKeyboard();
  });

  useEffect(() => {
    if (!isComposerBlocked) return;

    updateRichMessage(undefined);
  }, [attachments, isComposerBlocked, updateRichMessage]);

  const handleFormattedDateInsert = useLastCallback((text: ApiFormattedText) => {
    insertFormattedTextAndUpdateCursor(text);
  });

  const removeSymbol = useLastCallback(() => {
    richEditor.deleteCharacterBeforeSelection();
  });

  const handleAllScheduledClick = useLastCallback(() => {
    openThread({
      chatId, threadId, type: 'scheduled', noForumTopicPanel: true,
    });
  });

  const handleAutoDeleteClick = useLastCallback(() => {
    openAutoDeleteTimerModal({ chatId });
  });
  const handleToggleSilentPosting = useLastCallback(() => {
    const newValue = !isSilentPosting;
    updateChatSilentPosting({ chatId, isEnabled: newValue });

    showNotification({
      localId: 'silentPosting',
      icon: newValue ? 'mute' : 'unmute',
      message: lang(`ComposerSilentPosting${newValue ? 'Enabled' : 'Disabled'}Tootlip`),
    });
  });

  useEffect(() => {
    if (isRightColumnShown && isMobile) {
      closeSymbolMenu();
    }
  }, [isRightColumnShown, closeSymbolMenu, isMobile]);

  useEffect(() => {
    if (!isReady) return undefined;

    let timeout: number | undefined;
    if (isSelectModeActive) {
      disableHover();
    } else {
      timeout = window.setTimeout(() => {
        enableHover();
      }, SELECT_MODE_TRANSITION_MS);
    }
    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [isSelectModeActive, enableHover, disableHover, isReady]);

  const [shouldShowRichInputButton, setShouldShowRichInputButton] = useState(false);

  const updateShouldShowRichInputButton = useLastCallback(() => {
    if (hasAttachments) {
      setShouldShowRichInputButton(false);
      return;
    }

    requestMeasure(() => {
      const input = inputRef.current;
      if (!input || (!hasInputContent && !input.textContent)) {
        setShouldShowRichInputButton(false);
        return;
      }
      const { totalLines } = calcTextLineHeightAndCount(input, true);
      setShouldShowRichInputButton(totalLines >= MIN_COMPOSER_LINES);
    });
  });

  useEffect(() => {
    updateShouldShowRichInputButton();
  }, [richMessage, hasAttachments, hasInputContent, windowWidth]);
  useResizeObserver(inputRef, updateShouldShowRichInputButton, hasAttachments);

  const withBotMenuButton = isChatWithBot && botMenuButton?.type === 'webApp' && !editingMessage
    && messageListType === 'thread';
  const isBotMenuButtonOpen = withBotMenuButton && !hasInputContent && !activeRecording;

  const isComposerHasFocus = isComposerActive
    || isBotCommandMenuOpen || isBotMenuButtonOpen || isCustomSendMenuOpen;
  const isReactionSelectorOpen = isComposerHasFocus && !isReactionPickerOpen && isInStoryViewer && !isAttachMenuOpen
    && !isSymbolMenuOpen && !activeRecording && !hasInputContent;

  useEffect(() => {
    if (!isRichInputExpansionActive || editingRichMediaAttachment) {
      return undefined;
    }

    function handleDocumentMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement | undefined;
      if (!target) {
        return;
      }

      if (
        target.closest('.message-input-wrapper')
        || target.closest('.main-button')
        || target.closest('[data-text-formatter]')
        || target.closest('.Menu')
        || target.closest('.Modal')
        || target.closest('[aria-modal="true"]')
        || target.closest('.symbol-menu')
        || target.closest('.composer-tooltip')
      ) {
        return;
      }

      collapseRichInput();
    }

    const releaseEscKeyListener = captureEscKeyListener(handleRichInputEscape);
    document.addEventListener('mousedown', handleDocumentMouseDown);

    return () => {
      releaseEscKeyListener();
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, [editingRichMediaAttachment, handleRichInputEscape, isRichInputExpansionActive]);

  const slowModePlaceholder = (() => {
    if (!slowMode?.nextSendDate || slowMode.nextSendDate < getServerTime()) return undefined;

    return lang('SlowModePlaceholder', {
      timer: <TextTimer endsAt={slowMode.nextSendDate} onEnd={forceUpdate} />,
    }, { withNodes: true });
  })();

  const placeholder = useMemo(() => {
    if (activeRecording && windowWidth <= SCREEN_WIDTH_TO_HIDE_PLACEHOLDER) {
      return '';
    }

    if (!isComposerBlocked) {
      if (slowModePlaceholder) return slowModePlaceholder;
      if (isBotKeyboardOpen && botKeyboardPlaceholder) return botKeyboardPlaceholder;
      if (inputPlaceholder) return inputPlaceholder;

      if (chat?.adminRights?.anonymous) {
        return lang('ComposerPlaceholderAnonymous');
      }

      if (chat?.isBotForum && !user?.canManageBotForumTopics && threadId === MAIN_THREAD_ID) {
        return lang('ComposerPlaceholderBotTopicGeneral');
      }

      if (chat?.isForum && !chat.isBotForum && chat.isForumAsMessages && threadId === MAIN_THREAD_ID) {
        return replyToTopic
          ? lang('ComposerPlaceholderTopic', { topic: replyToTopic.title })
          : lang('ComposerPlaceholderTopicGeneral');
      }
      if (isChannel) {
        return lang(isSilentPosting ? 'ComposerPlaceholderBroadcastSilent' : 'ComposerPlaceholderBroadcast');
      }
      return lang('ComposerPlaceholder');
    }

    if (isInStoryViewer) return lang('ComposerStoryPlaceholderLocked');

    return lang('ComposerPlaceholderNoText');
  }, [
    activeRecording, botKeyboardPlaceholder, chat, inputPlaceholder, isBotKeyboardOpen, isChannel, isComposerBlocked,
    isInStoryViewer, isSilentPosting, lang, replyToTopic, threadId, windowWidth,
    slowModePlaceholder, user?.canManageBotForumTopics,
  ]);

  useEffect(() => {
    if (isComposerHasFocus) {
      onFocus?.();
    } else {
      onBlur?.();
    }
  }, [isComposerHasFocus, onBlur, onFocus]);

  const {
    shouldRender: shouldRenderReactionSelector,
    transitionClassNames: reactionSelectorTransitonClassNames,
  } = useShowTransitionDeprecated(isReactionSelectorOpen);
  const shouldForceVoiceMode = IS_VOICE_RECORDING_SUPPORTED && !canSendRoundVideos && canSendVoices;
  const shouldForceVideoMode = IS_VIDEO_RECORDING_SUPPORTED && !canSendVoices && canSendRoundVideos;
  const isRecordingVideoMode = IS_VIDEO_RECORDING_SUPPORTED
    && (recordMode === 'video' || !IS_VOICE_RECORDING_SUPPORTED || shouldForceVideoMode)
    && !shouldForceVoiceMode;
  const areRecordingsNotAllowed = mainButtonState === MainButtonState.Record
    && (!canAttachMedia || !canSendVoiceByPrivacy
      || (isRecordingVideoMode ? !canSendRoundVideos : !canSendVoices));

  const mainButtonHandler = useLastCallback(() => {
    switch (mainButtonState) {
      case MainButtonState.Stop:
        stopTypingDraft({ chatId, threadId, randomId: stoppableTypingDraftId! });
        break;
      case MainButtonState.Forward:
        onForward?.();
        break;
      case MainButtonState.Send:
        handleSendWithConfirmation();
        break;
      case MainButtonState.Record: {
        if (areRecordingsNotAllowed) {
          if (!canSendVoiceByPrivacy) {
            showNotification({
              message: isRecordingVideoMode
                ? {
                  key: 'VideoMessagesRestrictedByPrivacy',
                  variables: { user: chat?.title ?? '' },
                  options: { withNodes: true, withMarkdown: true },
                }
                : lang('NoVoiceMessagesAllowed', { user: chat?.title }),
            });
          } else if (isRecordingVideoMode ? !canSendRoundVideos : !canSendVoices) {
            showAllowedMessageTypesNotification({ chatId });
          }
        } else {
          setIsViewOnceEnabled(false);
          if (isRecordingVideoMode) {
            void startRecordingVideo();
          } else {
            void startRecordingVoice();
          }
        }
        break;
      }
      case MainButtonState.Edit:
        if (hasRichOnlyContent) {
          handleSendWithConfirmation();
        } else {
          handleEditComplete();
        }
        break;
      case MainButtonState.Schedule:
        if (!checkCanSendRichContent()) {
          break;
        }
        if (activeVoiceRecording) {
          pauseRecordingVoice();
        }
        if (activeVideoRecording) {
          finishRecordingVideo();
        }
        if (!currentMessageList) {
          return;
        }
        requestMessageSchedule((scheduledAt) => {
          handleMessageSchedule({}, scheduledAt, currentMessageList);
        });
        break;
      default:
        break;
    }
  });

  let mainButtonContextMenuHandler: typeof handleContextMenu | undefined;
  if (mainButtonState === MainButtonState.Send && canShowCustomSendMenu) {
    mainButtonContextMenuHandler = handleContextMenu;
  } else if (mainButtonState === MainButtonState.Record) {
    mainButtonContextMenuHandler = canSwitchRecordMode ? handleRecordModeContextMenu : stopEvent;
  }

  let sendButtonAriaLabel: RegularLangKey = 'SendMessage';
  switch (mainButtonState) {
    case MainButtonState.Forward:
      sendButtonAriaLabel = 'Forward';
      break;
    case MainButtonState.Edit:
      sendButtonAriaLabel = 'EditMessageAriaLabel';
      break;
    case MainButtonState.Record:
      if (!canAttachMedia) {
        sendButtonAriaLabel = 'ConversationDefaultRestrictedMedia';
      } else {
        sendButtonAriaLabel = isRecordingVideoMode ? 'AccDescrVideoMessage' : 'AccDescrVoiceMessage';
      }
  }

  const isMobileDevice = isMobile && (IS_IOS || IS_ANDROID);
  const isSendShortcutButton = !isMobileDevice
    && (mainButtonState === MainButtonState.Send || mainButtonState === MainButtonState.Edit);
  const sendButtonLabel = useKeyboardShortcutHint(
    lang(sendButtonAriaLabel),
    isSendShortcutButton ? 'sendMessage' : undefined,
    isRichInputExpansionActive ? 'ctrl-enter' : undefined,
  );
  const undoLabel = useKeyboardShortcutHint(lang('Undo'), 'undo');
  const redoLabel = useKeyboardShortcutHint(lang('Redo'), 'redo');

  const fullClassName = buildClassName(
    'Composer',
    isInMessageList && 'is-chat-composer',
    isInStoryViewer && 'is-story-composer',
    isInStoryViewer && isComposerEngaged && 'is-story-composer-focused',
    !isSelectModeActive && 'shown',
    isHoverDisabled && 'hover-disabled',
    isMounted && 'mounted',
    isEmbeddedMessageOpen && 'with-embedded',
    className,
  );
  const handleToggleReaction = useLastCallback((reaction: ApiReaction) => {
    let text: string | undefined;
    let entities: ApiMessageEntity[] | undefined;

    if (reaction.type === 'emoji') {
      text = reaction.emoticon;
    }

    if (reaction.type === 'custom') {
      const sticker = selectCustomEmoji(getGlobal(), reaction.documentId);
      if (!sticker) {
        return;
      }

      text = sticker.emoji || '';
      entities = text ? [{
        type: ApiMessageEntityTypes.CustomEmoji,
        offset: 0,
        length: text.length,
        documentId: sticker.id,
      }] : undefined;
    }

    sendMessage({ text, entities, isReaction: true });
    closeReactionPicker();
  });

  const handleReactionPickerOpen = useLastCallback((position: IAnchorPosition) => {
    if (isMobile) {
      document.querySelector<HTMLDivElement>(editableInputCssSelector)?.blur();
    }

    openStoryReactionPicker({
      peerId: chatId,
      storyId: storyId!,
      position,
      sendAsMessage: true,
    });
  });

  const handleLikeStory = useLastCallback(() => {
    const reaction = sentStoryReaction ? undefined : HEART_REACTION;
    sendStoryReaction({
      peerId: chatId,
      storyId: storyId!,
      containerId: getStoryKey(chatId, storyId!),
      reaction,
    });
  });

  const handleSendScheduled = useLastCallback(() => {
    if (!checkCanSendRichContent()) {
      return;
    }

    requestMessageSchedule((scheduledAt) => {
      handleMessageSchedule({}, scheduledAt, currentMessageList!);
    });
  });

  const handleSendSilent = useLastCallback(() => {
    if (!checkCanSendRichContent()) {
      return;
    }

    sendSilent();
  });

  const sendWhenOnline = useLastCallback(() => {
    handleMessageSchedule(
      {}, SCHEDULED_WHEN_ONLINE, currentMessageList!,
    );
  });

  const handleSendWhenOnline = useLastCallback(() => {
    if (!checkCanSendRichContent()) {
      return;
    }

    sendWhenOnline();
  });

  const handleSendScheduledAttachments = useLastCallback(
    (
      sendCompressed: boolean, sendGrouped: boolean, isInvertedMedia?: true,
      scheduledAt?: number,
    ) => {
      if (scheduledAt) {
        handleMessageSchedule(
          { sendCompressed, sendGrouped, isInvertedMedia },
          scheduledAt,
          currentMessageList!,
        );
      } else {
        requestMessageSchedule((calendarScheduledAt) => {
          handleMessageSchedule(
            { sendCompressed, sendGrouped, isInvertedMedia },
            calendarScheduledAt,
            currentMessageList!,
          );
        });
      }
    },
  );

  const handleSendSilentAttachments = useLastCallback(
    (sendCompressed: boolean, sendGrouped: boolean, isInvertedMedia?: true) => {
      sendSilent({ sendCompressed, sendGrouped, isInvertedMedia });
    },
  );

  const onSend = useMemo(() => {
    switch (mainButtonState) {
      case MainButtonState.Edit:
        return hasRichOnlyContent ? handleSendWithConfirmation : handleEditComplete;
      case MainButtonState.Schedule:
        return handleSendScheduled;
      default:
        return handleSendWithConfirmation;
    }
  }, [mainButtonState, hasRichOnlyContent, handleEditComplete, handleSendWithConfirmation]);

  const withBotCommands = isChatWithBot && botMenuButton?.type === 'commands' && !editingMessage
    && botCommands !== false && !activeRecording;

  const canExpandRichInput = isInMessageList && !isRichInputExpansionActive && !isEditingMedia;
  const canOpenRichInput = shouldShowRichInputButton && isInMessageList && !hasAttachments && !isRichInputExpanded
    && !isComposerBlocked && !isEditingMedia;
  const canCloseRichInput = Boolean(isRichInputExpansionActive && !isComposerBlocked);
  const canToggleRichInput = canOpenRichInput || canCloseRichInput;
  const {
    ref: voiceRecordBarRef, shouldRender: shouldRenderVoiceRecordBar,
  } = useShowTransition<HTMLDivElement>({
    isOpen: Boolean(activeRecording),
    withShouldRender: true,
  });
  const renderedRecording = useCurrentOrPrev(activeRecording);

  const {
    ref: roundVideoRecorderRef, shouldRender: shouldRenderRoundVideoRecorder,
  } = useShowTransition<HTMLDivElement>({
    isOpen: isVideoRecordingStarting || Boolean(activeVideoRecording && previewStream),
    withShouldRender: true,
    className: false,
  });
  const renderedVideoRecording = useCurrentOrPrev(activeVideoRecording);
  const renderedPreviewStream = useCurrentOrPrev(previewStream);

  const composer = (
    <div ref={composerRef} className={fullClassName}>
      {isInMessageList && canAttachMedia && !hasRichOnlyContent && isReady && !isRichInputExpansionActive && (
        <DropArea
          isOpen={dropAreaState !== DropAreaState.None}
          withQuick={dropAreaState === DropAreaState.QuickFile || prevDropAreaState === DropAreaState.QuickFile}
          editingMessage={editingMessage}
          onHide={onDropHide!}
          onFileSelect={handleFileSelect}
        />
      )}
      {shouldRenderReactionSelector && (
        <ReactionSelector
          topReactions={topReactions}
          allAvailableReactions={availableReactions}
          onToggleReaction={handleToggleReaction}
          isPrivate
          isReady={isReady}
          isInSavedMessages={isChatWithSelf}
          isInStoryViewer={isInStoryViewer}
          canPlayAnimatedEmojis={canPlayAnimatedEmojis}
          onShowMore={handleReactionPickerOpen}
          className={reactionSelectorTransitonClassNames}
        />
      )}
      <AttachmentModal
        chatId={chatId}
        threadId={threadId}
        richEditor={richEditor}
        canShowCustomSendMenu={canShowCustomSendMenu}
        attachments={attachments}
        isReady={isReady}
        shouldForceCompression={shouldForceCompression}
        shouldForceAsFile={shouldForceAsFile}
        isForCurrentMessageList={isForCurrentMessageList}
        isForMessage={isInMessageList}
        shouldSchedule={canSchedule && isInScheduledList}
        canSchedule={canSchedule}
        canSendGifs={canSendGifs}
        forceDarkTheme={isInStoryViewer}
        onSendSilent={handleSendSilentAttachments}
        onSend={handleSendAttachmentsFromModal}
        onSendScheduled={handleSendScheduledAttachments}
        onFileAppend={handleAppendFiles}
        onClear={handleClearAttachments}
        onAttachmentsUpdate={handleSetAttachments}
        editingMessage={editingMessage}
        onSendWhenOnline={sendWhenOnline}
        canScheduleUntilOnline={canSchedule && canScheduleUntilOnline && !isViewOnceEnabled}
      />
      <MediaEditor
        isOpen={Boolean(editingRichMediaAttachment)}
        source={richMediaEditorSource}
        initialEditState={editingRichMediaAttachment?.editState}
        chatId={chatId}
        onClose={handleCloseRichMediaEditor}
        onApply={handleApplyRichMediaEdit}
      />
      <SendAsMenu
        isOpen={isSendAsMenuOpen}
        onClose={closeSendAsMenu}
        chatId={chatId}
        selectedSendAsId={sendAsId}
        sendAsPeerIds={sendAsPeerIds}
        isCurrentUserPremium={isCurrentUserPremium}
      />
      {isInMessageList && (
        <>
          <ComposerEmbeddedMessage
            onClear={handleEmbeddedClear}
            onIsOpenChange={setIsEmbeddedMessageOpen}
            shouldForceShowEditing={Boolean(shouldForceShowEditing && editingMessage)}
            isHidden={isRichInputExpansionActive}
            chatId={chatId}
            threadId={threadId}
            messageListType={messageListType}
          />
          {!isRichInputExpansionActive && (
            <WebPagePreview
              chatId={chatId}
              threadId={threadId}
              isDisabled={!canAttachEmbedLinks || hasAttachments || hasRichOnlyContent || !hasInputContent}
              isEditing={Boolean(editingMessage)}
            />
          )}
        </>
      )}
      <div
        className={buildClassName(
          'composer-wrapper',
          isRichInputExpansionActive && 'rich-input-expanded',
        )}
      >
        <div
          className={buildClassName(
            'message-input-wrapper',
            peerColorClass,
            activeRecording && 'is-voice-recording',
          )}
          style={peerColorStyle}
        >
          {isInMessageList && !isRichInputExpansionActive && (
            <>
              {withBotMenuButton && (
                <BotMenuButton
                  isOpen={isBotMenuButtonOpen}
                  text={botMenuButton.text}
                  isDisabled={Boolean(activeRecording)}
                  onClick={handleClickBotMenu}
                />
              )}
              {withBotCommands && (
                <ResponsiveHoverButton
                  className={buildClassName(
                    'bot-commands', 'composer-action-button', isBotCommandMenuOpen && 'activated',
                  )}
                  round
                  disabled={botCommands === undefined}
                  color="translucent"
                  onActivate={handleActivateBotCommandMenu}
                  ariaLabel={lang('AriaOpenBotMenu')}
                >
                  <Icon name="hamburger" />
                </ResponsiveHoverButton>
              )}
              {canShowSendAs && sendAsPeer && (
                <Button
                  round
                  color="translucent"
                  onClick={isSendAsMenuOpen ? closeSendAsMenu : handleSendAsMenuOpen}
                  ariaLabel={lang('SendMessageAsTitle')}
                  className={buildClassName(
                    'send-as-button',
                    'composer-action-button',
                    shouldAnimateSendAsButtonRef.current && 'appear-animation',
                  )}
                >
                  <Avatar
                    peer={sendAsPeer}
                    size="tiny"
                  />
                </Button>
              )}
            </>
          )}
          <AttachMenu
            chatId={chatId}
            threadId={threadId}
            editingMessage={editingMessage}
            canEditMedia={canMediaBeReplaced}
            isRichInputExpanded={isRichInputExpansionActive}
            isButtonVisible={!activeRecording}
            canAttachMedia={canAttachMedia}
            canAttachFiles={isRichInputExpansionActive || !hasRichOnlyContent}
            canAttachPolls={canAttachPolls}
            canSendPhotos={canSendPhotos}
            canSendVideos={canSendVideos}
            canSendDocuments={canSendDocuments}
            canSendAudios={canSendAudios}
            canInsertDate={!isComposerBlocked}
            onFileSelect={isRichInputExpansionActive ? handleRichMediaSelect : handleFileSelect}
            onDateInsert={handleFormattedDateInsert}
            isScheduled={isInScheduledList}
            attachBots={isInMessageList ? attachBots : undefined}
            peerType={attachMenuPeerType}
            shouldCollectDebugLogs={shouldCollectDebugLogs}
            theme={theme}
            onMenuOpen={onAttachMenuOpen}
            onMenuClose={onAttachMenuClose}
            messageListType={messageListType}
            canExpandRichInput={canExpandRichInput}
            menuPositionX={isInMessageList ? 'left' : 'right'}
            onRichInputExpand={handleOpenRichInput}
          />
          <div
            className={buildClassName(
              'rich-editor-history',
              isRichInputExpansionActive && 'rich-editor-history-open',
            )}
            aria-hidden={!isRichInputExpansionActive}
            inert={!isRichInputExpansionActive}
          >
            <Button
              round
              faded
              size="smaller"
              color="translucent"
              ariaLabel={undoLabel}
              iconName="undo"
              disabled={!richEditor.canUndo}
              onClick={richEditor.undo}
            />
            <Button
              round
              faded
              size="smaller"
              color="translucent"
              ariaLabel={redoLabel}
              iconName="redo"
              disabled={!richEditor.canRedo}
              onClick={richEditor.redo}
            />
          </div>
          <Button
            round
            faded
            size="smaller"
            className={buildClassName(
              'rich-editor-button',
              !canToggleRichInput && 'rich-editor-button-hidden',
            )}
            color="translucent"
            ariaLabel={lang(isRichInputExpansionActive ? 'AriaComposerCloseRichInput' : 'AriaComposerOpenRichInput')}
            iconName={isRichInputExpansionActive ? 'collapse' : 'expand'}
            tabIndex={canToggleRichInput ? 0 : -1}
            disabled={isRichInputExpansionActive && hasRichMediaBlocking}
            onClick={isRichInputExpansionActive ? collapseRichInput : handleOpenRichInput}
          />
          <MessageInput
            ref={inputRef}
            id={inputId}
            editableInputId={editableInputId}
            richEditor={richEditor}
            tooltips={richEditorTooltips}
            isStoryInput={isInStoryViewer}
            chatId={chatId}
            canSendPlainText={!isComposerBlocked}
            isRichInputExpanded={isRichInputExpansionActive}
            threadId={threadId}
            isActive={!hasAttachments}
            placeholder={placeholder}
            canAutoFocus={isReady && isForCurrentMessageList && !hasAttachments && isInMessageList}
            noFocusInterception={hasAttachments}
            shouldSuppressFocus={isMobile && isSymbolMenuOpen}
            onRichInputCollapse={collapseRichInput}
            onRichInputExpand={handleOpenRichInput}
            onSend={onSend}
            onSuppressedFocus={closeSymbolMenu}
            onMediaEdit={handleRichMediaEdit}
            onMediaFiles={handleRichMediaFiles}
            onFocus={markInputHasFocus}
            onBlur={unmarkInputHasFocus}
            messageListType={messageListType}
            isRichOnlyContent={hasRichOnlyContent}
            maxLength={hasRichOnlyContent ? richMessageLengthLimit : LIMITS.messageLength}
          />
          {isInMessageList && !isRichInputExpansionActive && (
            <>
              {isInlineBotLoading && (
                <Spinner color="gray" />
              )}
              <Transition
                className="composer-action-buttons-container"
                slideClassName="composer-action-buttons"
                activeKey={Number(hasInputContent)}
                direction="inverse"
                name="slideFadeAndroid"
              >
                {!hasInputContent && (
                  <>
                    {isChannel && (
                      <Transition
                        className="composer-action-button"
                        name="reveal"
                        activeKey={Number(isSilentPosting)}
                      >
                        <Button
                          round
                          className="composer-action-button"
                          color="translucent"
                          onClick={handleToggleSilentPosting}
                          ariaLabel={lang(
                            isSilentPosting ? 'AriaComposerSilentPostingDisable' : 'AriaComposerSilentPostingEnable',
                          )}
                          iconName={isSilentPosting ? 'mute' : 'unmute'}
                        />
                      </Transition>
                    )}
                    {withScheduledButton && (
                      <Button
                        round
                        className="composer-action-button scheduled-button"
                        color="translucent"
                        onClick={handleAllScheduledClick}
                        ariaLabel={lang('AriaComposerOpenScheduled')}
                        iconName="schedule"
                      />
                    )}
                    {Boolean(autoDeletePeriod) && (
                      <Button
                        round
                        className="composer-action-button"
                        color="translucent"
                        onClick={handleAutoDeleteClick}
                        ariaLabel={lang('AutoDeleteSetInfo', { time: formatCountdown(lang, autoDeletePeriod) })}
                      >
                        <AutoDeleteOutlinedIcon period={autoDeletePeriod} />
                      </Button>
                    )}
                    {canShowBotKeyboard && (
                      <Button
                        className={buildClassName('composer-action-button', isBotKeyboardOpen && 'activated')}
                        round
                        color="translucent"
                        noFastClick
                        onClick={handleToggleBotKeyboard}
                        ariaLabel={lang(isBotKeyboardOpen ? 'AriaComposerHideBotKeyboard' : 'AriaComposerBotKeyboard')}
                      >
                        <Icon name="bot-keyboard" />
                      </Button>
                    )}
                  </>
                )}
              </Transition>
            </>
          )}
          {shouldRenderVoiceRecordBar && renderedRecording && (
            <VoiceRecordBar
              ref={voiceRecordBarRef}
              recording={renderedRecording}
              isVideo={Boolean(activeVideoRecording)}
              isPaused={activeVideoRecording ? (isVideoRecordingPaused || isRecordingFinished) : isRecordingPaused}
              canSendOneTimeMedia={canSendOneTimeMedia}
              isViewOnceEnabled={isViewOnceEnabled}
              onPause={activeVideoRecording ? pauseRecordingVideo : pauseRecordingVoice}
              onResume={activeVideoRecording ? resumeRecordingVideo : resumeRecordingVoice}
              onCancel={activeVideoRecording ? discardRecordingVideo : cancelRecordingVoice}
              onToggleViewOnce={toggleViewOnceEnabled}
              subscribeToPeaks={activeVideoRecording ? subscribeToVideoRecordingPeaks : subscribeToRecordingPeaks}
            />
          )}
          {shouldRenderRoundVideoRecorder && (
            <RoundVideoRecorder
              ref={roundVideoRecorderRef}
              previewStream={renderedPreviewStream}
              isReady={isVideoRecordingReady}
              isPaused={isVideoRecordingPaused}
              isFrozen={isRecordingFinished}
              getProgress={getProgress}
              getPlaybackEl={renderedVideoRecording?.getPlaybackEl}
            />
          )}
          {canShowSymbolMenu && (
            <SymbolMenuButton
              chatId={chatId}
              threadId={threadId}
              isMobile={isMobile}
              isReady={isReady}
              isSymbolMenuOpen={isSymbolMenuOpen}
              openSymbolMenu={openSymbolMenu}
              closeSymbolMenu={closeSymbolMenu}
              canSendStickers={canSendStickers}
              canSendGifs={canSendGifs}
              isMessageComposer={isInMessageList}
              onGifSelect={handleGifSelect}
              onGifAddCaption={hasRichOnlyContent ? undefined : handleGifAddCaption}
              onStickerSelect={handleStickerSelect}
              onCustomEmojiSelect={handleCustomEmojiSelect}
              onRemoveSymbol={removeSymbol}
              onEmojiSelect={insertTextAndUpdateCursor}
              closeBotCommandMenu={closeBotCommandMenu}
              closeSendAsMenu={closeSendAsMenu}
              onLoad={markSymbolMenuLoaded}
              isSymbolMenuForced={isSymbolMenuForced}
              keyboardSlotElement={isSymbolMenuInKeyboardSlot ? symbolMenuSlotRef.current : undefined}
              canSendPlainText={!isComposerBlocked}
              inputCssSelector={editableInputCssSelector}
              idPrefix={type}
              forceDarkTheme={isInStoryViewer}
            />
          )}
          {isInStoryViewer && !activeRecording && (
            <Button
              round
              className="composer-action-button story-reaction-button"
              color="translucent"
              onClick={handleLikeStory}
              onContextMenu={handleStoryPickerContextMenu}
              onMouseDown={handleBeforeStoryPickerContextMenu}
              ariaLabel={lang('AccDescrLike')}
              ref={storyReactionRef}
            >
              {sentStoryReaction && (
                <ReactionAnimatedEmoji
                  key={getReactionKey(sentStoryReaction)}
                  containerId={getStoryKey(chatId, storyId!)}
                  reaction={sentStoryReaction}
                  withEffectOnly={isSentStoryReactionHeart}
                />
              )}
              {(!sentStoryReaction || isSentStoryReactionHeart) && (
                <Icon
                  name={isSentStoryReactionHeart ? 'heart' : 'heart-outline'}
                  className={buildClassName(isSentStoryReactionHeart && 'story-reaction-heart')}
                />
              )}
            </Button>
          )}
          {isInMessageList && botCommands && (
            <BotCommandMenu
              isOpen={isBotCommandMenuOpen}
              chatId={chatId}
              threadId={threadId}
              botCommands={botCommands}
              onClose={closeBotCommandMenu}
            />
          )}
        </div>
      </div>
      <Button
        ref={mainButtonRef}
        round
        color={isInStoryViewer ? 'translucent' : 'secondary'}
        className={buildClassName(
          mainButtonState,
          'main-button',
          !isReady && 'not-ready',
          activeRecording && 'recording',
          isRecordingVideoMode && 'record-video',
        )}
        disabled={areRecordingsNotAllowed || hasRichMediaBlocking}
        allowDisabledClick
        noFastClick
        ariaLabel={mainButtonState === MainButtonState.Stop ? lang('BotDraftStop') : sendButtonLabel}
        onClick={mainButtonHandler}
        onContextMenu={mainButtonContextMenuHandler}
      >
        <Icon name="new-send" className="main-button-state-icon" />
        {isInMessageList && <Icon name="stop-square" className="main-button-state-icon" />}
        <Icon
          name={isInStoryViewer ? 'microphone-outline' : 'microphone'}
          className="main-button-state-icon main-button-microphone"
        />
        <Icon name="round-video" className="main-button-state-icon" />
        {onForward && <Icon name="forward" className="main-button-state-icon" />}
        {isInMessageList && <Icon name="schedule" className="main-button-state-icon" />}
        {isInMessageList && <Icon name="check" className="main-button-state-icon" />}
      </Button>
      {canShowCustomSendMenu && (
        <CustomSendMenu
          isOpen={isCustomSendMenuOpen}
          canSchedule={canSchedule && isInMessageList && !isViewOnceEnabled}
          canScheduleUntilOnline={canSchedule && canScheduleUntilOnline && !isViewOnceEnabled}
          onSendSilent={!isChatWithSelf ? handleSendSilent : undefined}
          onSendSchedule={!isInScheduledList ? handleSendScheduled : undefined}
          onSendWhenOnline={handleSendWhenOnline}
          onClose={handleContextMenuClose}
          onCloseAnimationEnd={handleContextMenuHide}
          isSavedMessages={isChatWithSelf}
        />
      )}
      {canSwitchRecordMode && (
        <RecordModeMenu
          isOpen={isRecordModeMenuOpen}
          onSelectMode={handleSelectRecordMode}
          onClose={handleRecordModeMenuClose}
          onCloseAnimationEnd={handleRecordModeMenuHide}
        />
      )}
      {calendar}
      <ConfirmDialog
        isOpen={isRemoveUnsupportedDialogOpen}
        title={lang('RemoveUnsupportedBlocksTitle')}
        text={lang('RemoveUnsupportedBlocksText')}
        confirmLabel={lang('RemoveUnsupportedBlocks')}
        confirmIsDestructive
        confirmHandler={handleRemoveUnsupported}
        onClose={closeRemoveUnsupportedDialog}
      />
      {isInMessageList && (
        <RemoveFormattingModal
          isOpen={isRemoveFormattingModalOpen}
          onClose={handleCloseRemoveFormattingModal}
          onCloseAnimationEnd={handleRemoveFormattingModalCloseAnimationEnd}
          onRemoveFormatting={handleRemoveFormatting}
        />
      )}
    </div>
  );

  if (!isInMessageList) return composer;

  return (
    <>
      {composer}
      <div
        ref={symbolMenuSlotRef}
        className={buildClassName('symbol-menu-slot', isBotKeyboardOpen && 'keyboard-open')}
        inert={isBotKeyboardOpen}
      />
      <BotKeyboard
        key={`${chatId}_${threadId}`}
        chatId={chatId}
        threadId={threadId}
        messageId={botKeyboardMessageId}
        isOpen={isBotKeyboardOpen}
        isSymbolMenuOpen={isSymbolMenuInKeyboardSlot && isSymbolMenuShown}
        onClose={hideBotKeyboard}
      />
    </>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, {
    chatId, threadId, storyId, messageListType, isMobile, type,
  }): Complete<StateProps> => {
    const chat = selectChat(global, chatId);
    const chatBot = !isSystemBot(chatId) ? selectBot(global, chatId) : undefined;
    const isChatWithBot = Boolean(chatBot);
    const isChatWithSelf = selectIsChatWithSelf(global, chatId);
    const isChatWithUser = isUserId(chatId);
    const userFullInfo = isChatWithUser ? selectUserFullInfo(global, chatId) : undefined;

    const chatFullInfo = !isChatWithUser ? selectChatFullInfo(global, chatId) : undefined;
    const messageWithActualBotKeyboard = (isChatWithBot || !isChatWithUser)
      && selectNewestMessageWithBotKeyboardButtons(global, chatId, threadId);
    const {
      shouldSuggestStickers, shouldSuggestCustomEmoji, shouldUpdateStickerSetOrder, lastRecordMessageMode,
    } = global.settings.byKey;
    const { shouldCollectDebugLogs } = selectSharedSettings(global);
    const language = selectLanguageCode(global);
    const {
      forwardMessages: { messageIds: forwardMessageIds },
      messageMediaEditorRequest,
    } = selectTabState(global);
    const mediaEditorMessage = messageMediaEditorRequest && messageMediaEditorRequest.chatId === chatId
      ? selectChatMessage(global, chatId, messageMediaEditorRequest.messageId)
      : undefined;
    const baseEmojiKeywords = global.emojiKeywords[BASE_EMOJI_KEYWORD_LANG];
    const emojiKeywords = language !== BASE_EMOJI_KEYWORD_LANG ? global.emojiKeywords[language] : undefined;
    const botKeyboardMessageId = messageWithActualBotKeyboard ? messageWithActualBotKeyboard.id : undefined;
    const keyboardMessage = botKeyboardMessageId
      ? selectChatMessageOrEphemeral(global, chatId, botKeyboardMessageId)
      : undefined;
    const { currentUserId } = global;
    const currentUser = selectUser(global, currentUserId!)!;
    const defaultSendAsId = chatFullInfo ? chatFullInfo?.sendAsId || currentUserId : undefined;
    const sendAsId = defaultSendAsId;
    const sendAsPeer = sendAsId ? selectPeer(global, sendAsId) : undefined;
    const requestedDraft = selectRequestedDraft(global, chatId);
    const requestedDraftFiles = selectRequestedDraftFiles(global, chatId);

    const tabState = selectTabState(global);
    const isStoryViewerOpen = Boolean(tabState.storyViewer.storyId);

    const currentMessageList = selectCurrentMessageList(global);
    const isForCurrentMessageList = chatId === currentMessageList?.chatId
      && threadId === currentMessageList?.threadId
      && messageListType === currentMessageList?.type
      && !isStoryViewerOpen;
    const user = selectUser(global, chatId);
    const canSendVoiceByPrivacy = (user && !userFullInfo?.noVoiceMessages) ?? true;
    const slowMode = chatFullInfo?.slowMode;
    const isCurrentUserPremium = selectIsCurrentUserPremium(global);

    const editingDraft = messageListType === 'scheduled'
      ? selectEditingScheduledDraft(global, chatId)
      : selectEditingDraft(global, chatId, threadId);

    const story = storyId && selectPeerStory(global, chatId, storyId);
    const sentStoryReaction = story && 'sentReaction' in story ? story.sentReaction : undefined;
    const draft = selectDraft(global, chatId, threadId);
    const replyToMessage = draft?.replyInfo
      ? selectChatMessage(global, chatId, draft.replyInfo.replyToMsgId)
      : undefined;
    const replyToTopic = chat?.isForum && chat.isForumAsMessages && threadId === MAIN_THREAD_ID && replyToMessage
      ? selectTopicFromMessage(global, replyToMessage)
      : undefined;
    const isInScheduledList = messageListType === 'scheduled';

    const noWebPage = selectNoWebPage(global, chatId, threadId);
    const isSilentPosting = chat && getChatNotifySettings(
      chat,
      selectNotifyDefaults(global),
      selectNotifyException(global, chatId),
    )?.isSilentPosting;

    const isForwarding = chatId === tabState.forwardMessages.toChatId;
    const isAccountFrozen = selectIsCurrentUserFrozen(global);
    const isAppConfigLoaded = global.isAppConfigLoaded;
    const insertingPeerIdMention = tabState.insertingPeerIdMention;

    const webPagePreview = selectWebPagePreview(global, chatId, threadId);

    const canManageAutoDelete = type === 'messageList' && messageListType === 'thread' && threadId === MAIN_THREAD_ID
      && selectCanManageAutoDelete(global, chatId);
    const autoDeletePeriod = canManageAutoDelete ? selectChatHistoryTtl(global, chatId) : undefined;

    return {
      availableReactions: global.reactions.availableReactions,
      topReactions: type === 'story' ? global.reactions.topReactions : undefined,
      isOnActiveTab: !tabState.isBlurred,
      recordMode: lastRecordMessageMode ?? 'voice',
      editingMessage: selectEditingMessage(global, chatId, threadId, messageListType),
      draft,
      chat,
      user,
      isChatWithBot,
      isChatWithSelf,
      isForCurrentMessageList,
      canScheduleUntilOnline: selectCanScheduleUntilOnline(global, chatId),
      isChannel: chat ? isChatChannel(chat) : undefined,
      isRightColumnShown: selectIsRightColumnShown(global, isMobile),
      isSelectModeActive: selectIsInSelectMode(global),
      withScheduledButton: (
        messageListType === 'thread'
        && (userFullInfo || chatFullInfo)?.hasScheduledMessages
      ),
      autoDeletePeriod: autoDeletePeriod || undefined,
      isInScheduledList,
      botKeyboardMessageId,
      botKeyboardPlaceholder: keyboardMessage?.keyboardPlaceholder,
      hiddenBotKeyboardId: selectTabThreadParam(global, chatId, threadId, 'hiddenBotKeyboardId'),
      hasActiveMiddleSearch: Boolean(selectCurrentMiddleSearch(global)),
      isForwarding,
      forwardedMessagesCount: isForwarding ? forwardMessageIds!.length : undefined,
      chatFullInfo,
      topInlineBotIds: global.topPeerCategories.botsInline?.peerIds,
      topGuestBotIds: global.topPeerCategories.botsGuestChat?.peerIds,
      currentUserId,
      currentUser,
      contentToBeScheduled: tabState.contentToBeScheduled,
      shouldSuggestStickers,
      shouldSuggestCustomEmoji,
      shouldUpdateStickerSetOrder,
      recentEmojis: global.recentEmojis,
      baseEmojiKeywords: baseEmojiKeywords?.keywords,
      emojiKeywords: emojiKeywords?.keywords,
      inlineBots: tabState.inlineBots.byUsername,
      isInlineBotLoading: tabState.inlineBots.isLoading,
      botCommands: userFullInfo ? (userFullInfo.botInfo?.commands || false) : undefined,
      botMenuButton: userFullInfo?.botInfo?.menuButton,
      sendAsPeer,
      sendAsId,
      editingDraft,
      requestedDraft,
      requestedDraftFiles,
      requestedRichInputMedia: type === 'messageList' ? tabState.requestedRichInputMedia : undefined,
      attachBots: global.attachMenu.bots,
      attachMenuPeerType: selectChatType(global, chatId),
      theme: selectTheme(global),
      isCurrentUserPremium,
      canSendVoiceByPrivacy,
      attachmentSettings: global.attachmentSettings,
      slowMode,
      currentMessageList,
      isReactionPickerOpen: selectIsReactionPickerOpen(global),
      canPlayAnimatedEmojis: selectCanPlayAnimatedEmojis(global),
      canSendOneTimeMedia: !isChatWithSelf && isChatWithUser && !isChatWithBot && !isInScheduledList,
      shouldCollectDebugLogs,
      sentStoryReaction,
      replyToTopic,
      noWebPage,
      webPagePreview,
      richMessageLengthLimit: global.appConfig.richMessageLengthLimit,
      richMessageMaxBlocks: global.appConfig.richMessageMaxBlocks,
      richMessageMaxDepth: global.appConfig.richMessageMaxDepth,
      richMessageMaxMedia: global.appConfig.richMessageMaxMedia,
      richMessageMaxTableColumns: global.appConfig.richMessageMaxTableColumns,
      isSilentPosting,
      isAccountFrozen,
      isAppConfigLoaded,
      insertingPeerIdMention,
      isRichInputExpanded: tabState.isRichInputExpanded,
      stoppableTypingDraftId: selectStoppableTypingDraftId(global, chatId, threadId),
      mediaEditorMessage,
    };
  },
)(Composer));
