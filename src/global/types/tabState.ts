import type {
  ApiAttachBot,
  ApiAudio,
  ApiBirthday,
  ApiChatInviteInfo,
  ApiChatlistInvite,
  ApiChatType,
  ApiDialog,
  ApiFormattedText,
  ApiGeoPoint,
  ApiGlobalMessageSearchType,
  ApiLanguage,
  ApiLimitTypeWithModal,
  ApiMessage,
  ApiMissingInvitedUser,
  ApiNewPoll,
  ApiNotification,
  ApiPhoneCall,
  ApiPreparedInlineMessage,
  ApiReaction,
  ApiRequestPeerType,
  ApiRichText,
  ApiSearchPostsFlood,
  ApiSticker,
  ApiTypeStoryView,
  ApiUrlAuthResultRequest,
  ApiUser,
  ApiVideo,
} from '../../api/types';
import type { FoldersActions } from '../../hooks/reducers/useFoldersReducer';
import type { ReducerAction } from '../../hooks/useReducer';
import type {
  ActiveDownloads,
  ActiveEmojiInteraction,
  ChatCreationProgress,
  ChatMediaSearchParams,
  ConfettiStyle,
  FocusDirection,
  GlobalSearchContent,
  IAnchorPosition,
  InlineBotSettings,
  LeftColumnContent,
  ManagementProgress,
  ManagementState,
  MediaViewerMedia,
  MediaViewerOrigin,
  MediaViewerPageMedia,
  MessageList,
  MessageListType,
  MiddleSearchParams,
  NewChatMembersProgress,
  PlaybackItemRef,
  PlaybackSource,
  ProfileEditProgress,
  ProfileTabType,
  RoundVideoMode,
  ScrollTargetPosition,
  SettingsConfirmation,
  SettingsHighlight,
  SettingsScreens,
  SharedMediaType,
  ShuffleState,
  StoryViewerOrigin,
  TabThread,
  ThreadId,
} from '../../types';
import type { BrowserState } from '../../types/browser';
import type { RegularLangKey } from '../../types/language';
import type { WebAppMediaKind } from '../../types/webapp';
import type { SearchResultKey } from '../../util/keys/searchResultKey';
import type { CallbackAction } from './actions';

export type PollVote = {
  peerId: string;
  date: number;
};

export type ReactionDeletionContext = {
  peerId: string;
  count: number;
};

type ReportOptionsSection = {
  type: 'options';
  title: string;
  subtitle?: string;
  options: {
    text: string;
    option: string;
  }[];
};

type ReportCommentSection = {
  type: 'comment';
  title?: string;
  isOptional?: boolean;
  option: string;
};

export type ReportSection = ReportOptionsSection | ReportCommentSection;

type MessageReportContext = {
  option: string;
  description: string;
  title?: string;
  sections: ReportSection[];
  isSubmitting?: boolean;
};

export type MusicPickerSharedResults = {
  generation: number;
  ids: SearchResultKey[];
  loadedCount?: number;
  nextOffsetRate?: number;
  nextOffsetId?: number;
  nextOffsetPeerId?: string;
  totalCount?: number;
  isLoading?: boolean;
  isFullyLoaded?: boolean;
};

export type MusicPickerGlobalResults = {
  query: string;
  generation: number;
  ids: string[];
  nextOffset?: string;
  isLoading?: boolean;
  isFullyLoaded?: boolean;
};

export type TabState = {
  id: number;
  isBlurred?: boolean;
  isMasterTab: boolean;
  inactiveReason?: 'auth' | 'otherClient';
  shouldPreventComposerAnimation?: boolean;
  isRichInputExpanded?: boolean;
  richMediaUploadBlockingCount?: number;
  inviteHash?: string;
  canInstall?: boolean;
  isLeftColumnShown: boolean;
  newChatMembersProgress?: NewChatMembersProgress;
  uiReadyState: 0 | 1 | 2;
  shouldInit: boolean;
  shouldSkipHistoryAnimations?: boolean;

  shouldCloseRightColumn?: boolean;
  chatInfo: {
    isOpen: boolean;
    profileTab?: ProfileTabType;
    forceScrollProfileTab?: boolean;
    isOwnProfile?: boolean;
  };
  nextFoldersAction?: ReducerAction<FoldersActions>;
  shareFolderScreen?: {
    folderId: number;
    isFromSettings?: boolean;
    url?: string;
    isLoading?: boolean;
  };

  isCallPanelVisible?: boolean;
  multitabNextAction?: CallbackAction;
  ratingPhoneCall?: ApiPhoneCall;

  messageLists: MessageList[];
  globalThemePreviewChatId?: string;

  contentToBeScheduled?: {
    gif?: ApiVideo;
    sticker?: ApiSticker;
    poll?: ApiNewPoll;
    isSilent?: boolean;
    sendGrouped?: boolean;
    sendCompressed?: boolean;
    isInvertedMedia?: true;
  };

  activeChatFolder: number;
  tabThreads: Record<string, Record<ThreadId, TabThread>>;
  forumPanelChatId?: string;
  communityPanelId?: string;

  focusedMessage?: {
    chatId?: string;
    threadId?: ThreadId;
    messageId?: number;
    direction?: FocusDirection;
    noHighlight?: boolean;
    isResizingContainer?: boolean;
    quote?: string;
    quoteOffset?: number;
    pollOption?: string;
    scrollTargetPosition?: ScrollTargetPosition;
  };

  selectedMessages?: {
    chatId: string;
    messageIds: number[];
    reportContext?: MessageReportContext;
  };

  chatInviteModal?: {
    hash: string;
    inviteInfo: ApiChatInviteInfo;
  };

  seenByModal?: {
    chatId: string;
    messageId: number;
  };

  privacySettingsNoticeModal?: {
    chatId: string;
    isReadDate: boolean;
  };

  reactorModal?: {
    chatId: string;
    messageId: number;
  };

  reactionPicker?: {
    chatId?: string;
    messageId?: number;
    storyPeerId?: string;
    storyId?: number;
    position?: IAnchorPosition;
    sendAsMessage?: boolean;
  };

  recoveryEmail?: string;

  inlineBots: {
    isLoading: boolean;
    byUsername: Record<string, false | InlineBotSettings>;
  };

  leftColumn: {
    contentKey: LeftColumnContent;
    settingsScreen: SettingsScreens;
    settingsHighlight?: SettingsHighlight;
  };

  globalSearch: {
    query?: string;
    minDate?: number;
    maxDate?: number;
    currentContent?: GlobalSearchContent;
    chatId?: string;
    foundTopicIds?: number[];
    searchFlood?: ApiSearchPostsFlood;
    fetchingStatus?: {
      chats?: boolean;
      messages?: boolean;
      botApps?: boolean;
      publicPosts?: boolean;
    };
    isClosing?: boolean;
    localResults?: {
      peerIds?: string[];
    };
    globalResults?: {
      peerIds?: string[];
    };
    popularBotApps?: {
      peerIds: string[];
      nextOffset?: string;
    };
    resultsByType?: Partial<Record<ApiGlobalMessageSearchType, {
      totalCount?: number;
      nextOffsetId?: number;
      nextOffsetPeerId?: string;
      nextOffsetRate?: number;
      foundIds: SearchResultKey[];
    }>>;
  };

  activeEmojiInteractions?: ActiveEmojiInteraction[];
  activeReactions: Record<string, ApiReaction[]>;

  middleSearch: {
    byChatThreadKey: Record<string, MiddleSearchParams | undefined>;
  };

  sharedMediaSearch: {
    byChatThreadKey: Record<string, {
      currentType?: SharedMediaType;
      resultsByType?: Partial<Record<SharedMediaType, {
        totalCount?: number;
        nextOffsetId: number;
        foundIds: number[];
      }>>;
    }>;
  };

  chatMediaSearch: {
    byChatThreadKey: Record<string, ChatMediaSearchParams>;
  };

  management: {
    progress?: ManagementProgress;
    byChatId: Record<string, ManagementState>;
  };

  storyViewer: {
    isRibbonShown?: boolean;
    isArchivedRibbonShown?: boolean;
    peerId?: string;
    storyId?: number;
    isMuted: boolean;
    isSinglePeer?: boolean;
    isSingleStory?: boolean;
    isPrivate?: boolean;
    isArchive?: boolean;
    // Last viewed story id in current view session.
    // Used for better switch animation between peers.
    lastViewedByPeerId?: Record<string, number>;
    isPrivacyModalOpen?: boolean;
    isPaymentConfirmDialogOpen?: boolean;
    viewModal?: {
      storyId: number;
      views?: ApiTypeStoryView[];
      nextOffset?: string;
      isLoading?: boolean;
    };
    origin?: StoryViewerOrigin;
    // Copy of story list for current view session
    storyList?: {
      peerIds: string[];
      storyIdsByPeerId: Record<string, number[]>;
    };
  };
  storyStealthModal?: {
    targetPeerId: string;
  } | Record<string, never>;

  selectedStoryAlbumId?: number;

  mediaViewer: {
    chatId?: string;
    threadId?: ThreadId;
    messageId?: number;
    withDynamicLoading?: boolean;
    mediaIndex?: number;
    isAvatarView?: boolean;
    standaloneMedia?: MediaViewerMedia[];
    pageMedia?: MediaViewerPageMedia;
    origin?: MediaViewerOrigin;
    volume: number;
    playbackRate: number;
    isMuted: boolean;
    isHidden?: boolean;
    timestamp?: number;
    shouldLandInMediaEditor?: boolean;
    // Signal: the view-once message whose media is open; closing the viewer marks it viewed
    viewOnceMessage?: { chatId: string; messageId: number };
  };

  audioPlayer: {
    activeItem?: PlaybackItemRef;
    source?: PlaybackSource;
    playbackRate: number;
    isPlaybackRateActive?: boolean;
    timestamp?: number;
    isMuted: boolean;
    shuffle?: ShuffleState;
    pendingStep?: {
      direction: 'next' | 'prev';
      isAuto?: boolean;
    };
    // Round video leaves its message for the floating player even while the message is visible
    roundVideoMode?: RoundVideoMode;
  };

  isAudioPlaylistModalOpen?: boolean;

  loadingThread?: {
    loadingChatId: string;
    loadingMessageId: number;
  };

  isShareMessageModalShown?: boolean;

  replyingMessage: {
    fromChatId?: string;
    messageId?: number;
    quoteText?: ApiFormattedText;
    quoteRich?: ApiRichText[];
    quoteOffset?: number;
    toChatId?: string;
    toThreadId?: ThreadId;
  };

  forwardMessages: {
    fromChatId?: string;
    messageIds?: number[];
    storyId?: number;
    audioItem?: PlaybackItemRef;
    toChatId?: string;
    toThreadId?: ThreadId;
    withMyScore?: boolean;
    noAuthors?: boolean;
    noCaptions?: boolean;
  };

  pollResults: {
    chatId?: string;
    messageId?: number;
    votesByOption?: Record<string, PollVote[]>;
    offsets?: Record<string, string>;
  };

  chatCreation?: {
    progress: ChatCreationProgress;
    error?: RegularLangKey;
  };

  profileEdit?: {
    progress: ProfileEditProgress;
    checkedUsername?: string;
    isUsernameAvailable?: boolean;
    error?: string;
  };

  notifications: ApiNotification[];
  dialogs: ApiDialog[];

  safeLinkModalUrl?: string;
  safeLinkModalIsWidget?: boolean;
  mapModal?: {
    point: ApiGeoPoint;
    zoom?: number;
  };
  historyCalendarSelectedAt?: number;
  openedStickerSetShortName?: string;
  openedCustomEmojiSetIds?: string[];

  reportModal?: {
    chatId?: string;
    messageIds: number[];
    description: string;
    peerId?: string;
    subject: 'story' | 'message';
    sections: ReportSection[];
  };

  activeDownloads: ActiveDownloads;

  newContact?: {
    userId?: string;
    isByPhoneNumber?: boolean;
  };

  openedGame?: {
    url: string;
    chatId: string;
    messageId: number;
  };

  requestedDraft?: {
    chatId?: string;
    text: ApiFormattedText;
    files?: File[];
    filter?: ApiChatType[];
  };

  requestedRichInputMedia?: {
    chatId: string;
    threadId: ThreadId;
    messageListType: MessageListType;
    audio?: ApiAudio;
    files?: File[];
  };

  pollModal?: {
    chatId: string;
    threadId?: ThreadId;
    messageListType: MessageListType;
  };

  musicPicker?: {
    chatId: string;
    threadId: ThreadId;
    messageListType: MessageListType;
    shouldInsertToRichInput?: boolean;
    shared?: MusicPickerSharedResults;
    global?: MusicPickerGlobalResults;
  };

  preparedMessageModal?: {
    message: ApiPreparedInlineMessage;
    webAppKey: string;
    botId: string;
  };

  requestPeerModal?: {
    botId: string;
    chatId: string;
    messageId: number;
    buttonId: number;
    maxQuantity: number;
    peerType: ApiRequestPeerType;
  };

  botCreationModal?: {
    managerId: string;
    suggestedName?: string;
    suggestedUsername?: string;
    occupiedUsername?: string;
  };

  sharePreparedMessageModal?: {
    webAppKey: string;
    message: ApiPreparedInlineMessage;
    filter: ApiChatType[];
  };

  browser: BrowserState;

  botTrustRequest?: {
    botId: string;
    type: 'game' | 'webApp' | 'botApp';
    shouldRequestWriteAccess?: boolean;
    onConfirm?: CallbackAction;
  };
  requestedAttachBotInstall?: {
    bot: ApiAttachBot;
    onConfirm?: CallbackAction;
  };
  requestedAttachBotInChat?: {
    bot: ApiAttachBot;
    filter: ApiChatType[];
    startParam?: string;
  };
  requestedBotStartGroup?: {
    bot: ApiUser;
    startParam?: string;
  };
  // A start parameter from a link waits for the user to press START
  pendingBotStart?: {
    botId: string;
    param: string;
  };

  emojiStatusAccessModal?: {
    bot: ApiUser;
    webAppKey: string;
  };

  locationAccessModal?: {
    bot: ApiUser;
    webAppKey: string;
  };

  mediaAccessModal?: {
    bot: ApiUser;
    webAppKey: string;
    kinds: WebAppMediaKind[];
  };

  confetti?: {
    lastConfettiTime?: number;
    top?: number;
    left?: number;
    width?: number;
    height?: number;
    style?: ConfettiStyle;
    withStars?: boolean;
  };
  wave?: {
    lastWaveTime: number;
    startX: number;
    startY: number;
  };

  urlAuth?: {
    button?: {
      chatId: string;
      messageId: number;
      buttonId: number;
    };
    matchCode?: string;
    request?: Omit<ApiUrlAuthResultRequest, 'type' | 'bot'> & { botId: string };
    url: string;
  };

  languageModal?: {
    requestId: number;
    langCode: string;
    language?: ApiLanguage;
    isLoading?: boolean;
    isApplying?: boolean;
    error?: 'unsupported' | 'failed';
  };

  deleteMessageModal?: {
    chatId: string;
    messageIds: number[];
    isSchedule?: boolean;
    onConfirm?: NoneToVoidFunction;
    reactionContext?: ReactionDeletionContext;
  };

  deleteMemberModal?: {
    chatId: string;
    peerId: string;
  };

  joinGroupCallModal?: {
    chatId: string;
    id: string;
    accessHash: string;
    inviteHash?: string;
  };

  isBrowserCloseConfirmationModalOpen?: boolean;

  isQuickChatPickerOpen?: boolean;

  isFrozenAccountModalOpen?: boolean;

  disableSharingAboutModal?: {
    userId: string;
  };

  limitReachedModal?: {
    limit: ApiLimitTypeWithModal;
  };

  deleteFolderDialogModal?: number;

  createTopicPanel?: {
    chatId: string;
    isLoading?: boolean;
  };

  editTopicPanel?: {
    chatId: string;
    topicId: number;
    isLoading?: boolean;
  };

  chatlistModal?: {
    invite?: ApiChatlistInvite;
    removal?: {
      folderId: number;
      suggestedPeerIds?: string[];
    };
  };

  deleteAccountModal?: {
    selfDestructAccountDays: number;
  };

  isAgeVerificationModalOpen?: boolean;

  birthdaySetupModal?: {
    currentBirthday?: ApiBirthday;
    suggestForUserId?: string;
    isFromSuggestion?: boolean;
  };

  suggestMessageModal?: {
    chatId: string;
    messageId?: number;
  };

  suggestedPostApprovalModal?: {
    chatId: string;
    messageId: number;
  };

  inviteViaLinkModal?: {
    missingUsers: ApiMissingInvitedUser[];
    chatId: string;
  };

  oneTimeMediaModal?: {
    message: ApiMessage;
  };

  qrCodeModal?: {
    peerId: string;
  };

  suggestedStatusModal?: {
    botId: string;
    webAppKey?: string;
    customEmojiId: string;
    duration?: number;
  };

  profileRatingModal?: {
    userId: string;
    level: number;
  };

  quickPreview?: {
    chatId: string;
    threadId?: ThreadId;
  };

  isPasskeyModalOpen?: boolean;

  settingsConfirmation?: SettingsConfirmation;

  leaveGroupModal?: {
    chatId: string;
    nextOwnerId?: string;
  };

  autoDeleteTimerModal?: {
    chatId: string;
  };

  isTwoFaCheckModalOpen?: true;

  insertingPeerIdMention?: string;
  shouldSaveAttachmentsCompression?: boolean;

  rankModal?: {
    chatId: string;
    userId: string;
    isAdmin?: boolean;
    isOwner?: boolean;
    rank?: string;
  };
  editRankModal?: {
    chatId: string;
    userId: string;
    isAdmin?: boolean;
    isOwner?: boolean;
    rank?: string;
  };
  messageMediaEditorRequest?: {
    chatId: string;
    messageId: number;
    videoTime?: number;
  };
};
