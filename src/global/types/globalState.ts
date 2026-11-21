import type {
  ApiAiComposeToneType,
  ApiAppConfig,
  ApiAttachBot,
  ApiAudio,
  ApiAuthCodeInfo,
  ApiAvailableReaction,
  ApiBotPreviewMedia,
  ApiChat,
  ApiChatFolder,
  ApiChatFullInfo,
  ApiChatlistExportedInvite,
  ApiChatTheme,
  ApiConfig,
  ApiCountry,
  ApiCountryCode,
  ApiEmojiGroup,
  ApiEmojiStatusType,
  ApiGroupCall,
  ApiHistorySyncProgress,
  ApiMessage,
  ApiMessagePoll,
  ApiNotifyPeerType,
  ApiPasskey,
  ApiPasskeyOption,
  ApiPeerColors,
  ApiPeerNotifySettings,
  ApiPeerPhotos,
  ApiPeerStories,
  ApiPhoneCall,
  ApiPrivacyKey,
  ApiPrivacySettings,
  ApiPromoData,
  ApiReaction,
  ApiReactionKey,
  ApiSavedReactionTag,
  ApiSession,
  ApiShareThemeBackdrop,
  ApiStealthMode,
  ApiSticker,
  ApiStickerSet,
  ApiStoryAlbum,
  ApiStoryDistributionList,
  ApiStorySettings,
  ApiTopPeerCategory,
  ApiTranscription,
  ApiUpdateAuthorizationStateType,
  ApiUpdateConnectionStateType,
  ApiUser,
  ApiUserCommonChats,
  ApiUserFullInfo,
  ApiUserSavedMusic,
  ApiUserStatus,
  ApiVideo,
  ApiWallpaper,
  ApiWebPage,
  ApiWebSession,
} from '../../api/types';
import type {
  AccountSettings,
  AttachmentCompression,
  BotAppPermissions,
  ChatListType,
  ChatTranslatedMessages,
  EmojiKeywords,
  OrderMode,
  RepeatMode,
  ServiceNotification,
  SimilarBotsInfo,
  TextSummary,
  Thread,
  ThreadId,
  TopicsInfo,
  WebPageMediaSize,
} from '../../types';
import type { MediaEditorSettings } from '../../types/mediaEditor';
import type { RegularLangFnParameters } from '../../util/localization';
import type { SharedState } from './sharedState';
import type { TabState } from './tabState';

export type GlobalState = {
  cacheVersion: number;
  isInited: boolean;
  config?: ApiConfig;
  appConfig: ApiAppConfig;
  promoData?: ApiPromoData;
  peerColors?: ApiPeerColors;
  shareThemeBackdrops?: {
    list: ApiShareThemeBackdrop[];
    hash: number;
  };
  aiComposeTones?: {
    tones: ApiAiComposeToneType[];
    hash: string;
  };
  isCacheApiSupported?: boolean;
  connectionState?: ApiUpdateConnectionStateType;
  currentUserId?: string;
  messageWidgetStorage: Record<string, Record<number, {
    senderId: string;
    threadId: ThreadId;
    storage: {
      local?: Record<string, string>;
      session?: Record<string, string>;
    };
    // When the widget was last shown or wrote `local` (`Date.now()`), for the cap on stored widgets
    lastSeenAt?: number;
    // The last content height the widget reported and its resize anchor, so the bubble opens at its size
    height?: number;
    resizeAnchor?: 'top' | 'bottom';
  }>>;
  isSyncing?: boolean;
  isAppConfigLoaded?: boolean;
  isAppUpdateAvailable?: boolean;
  isSynced?: boolean;
  isFetchingDifference?: boolean;
  leftColumnWidth?: number;
  lastIsChatInfoShown?: boolean;
  initialUnreadNotifications?: number;
  shouldShowContextMenuHint?: boolean;
  botFreezeAppealId?: string;
  reactionPollingPause?: {
    until: number;
    chatId: string;
  };

  audioPlayer: {
    volume: number;
    lastPlaybackRate: number;
    isLastPlaybackRateActive?: boolean;
    repeatMode: RepeatMode;
    orderMode: OrderMode;
  };

  mediaViewer: {
    lastPlaybackRate: number;
  };

  recentlyFoundChatIds?: string[];
  recentlyFoundSettingIds?: string[];

  twoFaSettings: {
    hint?: string;
    isLoading?: boolean;
    errorKey?: RegularLangFnParameters;
    waitingEmailCodeLength?: number;
  };

  attachmentSettings: {
    shouldCompress: boolean;
    defaultAttachmentCompression: AttachmentCompression;
    shouldSendGrouped: boolean;
    isInvertedMedia?: true;
    webPageMediaSize?: WebPageMediaSize;
    shouldSendInHighQuality?: boolean;
  };

  mediaEditorSettings?: MediaEditorSettings;

  attachMenu: {
    hash?: string;
    bots: Record<string, ApiAttachBot>;
  };

  passcode: {
    isScreenLocked?: boolean;
    hasPasscode?: boolean;
    hasPasskey?: boolean;
    autolockDuration?: number;
    isDataCorrupted?: boolean;
    errorKey?: RegularLangFnParameters;
    timeoutUntil?: number;
    invalidAttemptsCount?: number;
    isLoading?: boolean;
  };

  auth: {
    isLoggingOut?: boolean;
    state?: ApiUpdateAuthorizationStateType;
    phoneNumber?: string;
    isLoading?: boolean;
    isLoadingQrCode?: boolean;
    errorKey?: RegularLangFnParameters;
    rememberMe?: boolean;
    nearestCountry?: string;
    isCodeViaApp?: boolean;
    codeInfo?: ApiAuthCodeInfo;
    hint?: string;
    qrCode?: {
      token: string;
      expires: number;
    };
    historySync?: ApiHistorySyncProgress;
    passkeyOption?: ApiPasskeyOption;

  };
  countryList: {
    phoneCodes: ApiCountryCode[];
    general: ApiCountry[];
  };

  contactList?: {
    userIds: string[];
  };

  blocked: {
    ids: string[];
    totalCount: number;
  };

  users: {
    byId: Record<string, ApiUser>;
    statusesById: Record<string, ApiUserStatus>;
    savedMusicById?: Record<string, true>;
    isSavedMusicLoading?: boolean;
    savedMusicByPeerId: Record<string, ApiUserSavedMusic>;
    // Obtained from GetFullUser / UserFullInfo
    fullInfoById: Record<string, ApiUserFullInfo>;
    previewMediaByBotId: Record<string, ApiBotPreviewMedia[]>;
    commonChatsById: Record<string, ApiUserCommonChats>;
    botAppPermissionsById: Record<string, BotAppPermissions>;
  };

  peers: {
    profilePhotosById: Record<string, ApiPeerPhotos>;
  };

  chats: {
    // TODO Replace with `Partial<Record>` to properly handle missing keys
    byId: Record<string, ApiChat>;
    listIds: {
      active?: string[];
      archived?: string[];
      saved?: string[];
    };
    orderedPinnedIds: {
      active?: string[];
      archived?: string[];
      saved?: string[];
    };
    totalCount: {
      all?: number;
      archived?: number;
      saved?: number;
    };
    isFullyLoaded: {
      active?: boolean;
      archived?: boolean;
      saved?: boolean;
    };
    lastMessageIds: {
      all?: Record<string, number>;
      saved?: Record<string, number>;
    };
    topicsInfoById: Record<string, TopicsInfo>;
    loadingParameters: Record<ChatListType, {
      nextOffsetId?: number;
      nextOffsetPeerId?: string;
      nextOffsetDate?: number;
    }>;
    forDiscussionIds?: string[];
    // Obtained from GetFullChat / GetFullChannel
    fullInfoById: Record<string, ApiChatFullInfo>;
    similarChannelsById: Partial<Record<string, {
      isExpanded: boolean;
      similarChannelIds?: string[];
      count?: number;
    }>>;
    notifyExceptionById: Record<string, ApiPeerNotifySettings>;

    similarBotsById: Record<string, SimilarBotsInfo>;

    personalChannelIds?: string[];
  };

  messages: {
    byChatId: Record<string, {
      byId: Record<number, ApiMessage>;
      ephemeralById: Record<number, ApiMessage>;
      anchoredById: Record<number, ApiMessage>;
      summaryById: Record<number, TextSummary>;
      threadsById: Record<ThreadId, Thread>;
    }>;
    playbackByChatId: Record<string, {
      byId: Record<number, number>;
    }>;
    pollById: Record<string, ApiMessagePoll>;
    webPageById: Record<string, ApiWebPage>;
  };

  stories: {
    byPeerId: Record<string, ApiPeerStories>;
    hasNext?: boolean;
    stateHash?: string;
    hasNextInArchive?: boolean;
    archiveStateHash?: string;
    orderedPeerIds: {
      active: string[];
      archived: string[];
    };
    stealthMode: ApiStealthMode;
    albumsByPeerId: Record<string, ApiStoryAlbum[]>;
    // Signal: My Story and custom distribution lists, and the stories settings of the account
    distributionLists?: ApiStoryDistributionList[];
    settings?: ApiStorySettings;
  };

  groupCalls: {
    byId: Record<string, ApiGroupCall>;
    activeGroupCallId?: string;
  };

  scheduledMessages: {
    byChatId: Record<string, {
      byId: Record<number, ApiMessage>;
    }>;
  };

  chatFolders: {
    orderedIds?: number[];
    byId: Record<number, ApiChatFolder>;
    invites: Record<number, ApiChatlistExportedInvite[]>;
    recommended?: ApiChatFolder[];
    areTagsEnabled?: boolean;
  };

  phoneCall?: ApiPhoneCall;

  fileUploads: {
    byMessageKey: Record<string, {
      progress: number;
    }>;
  };

  recentEmojis: string[];
  recentCustomEmojis: string[];

  reactions: {
    topReactions: ApiReaction[];
    recentReactions: ApiReaction[];
    defaultTags: ApiReaction[];
    availableReactions?: ApiAvailableReaction[];
    hash: {
      topReactions?: string;
      recentReactions?: string;
      defaultTags?: string;
    };
  };

  stickers: {
    setsById: Record<string, ApiStickerSet>;
    added: {
      hash?: string;
      setIds?: string[];
    };
    recent: {
      hash?: string;
      stickers: ApiSticker[];
    };
    favorite: {
      hash?: string;
      stickers: ApiSticker[];
    };
    greeting: {
      hash?: string;
      stickers: ApiSticker[];
    };
    premium: {
      hash?: string;
      stickers: ApiSticker[];
    };
    featured: {
      hash?: string;
      setIds?: string[];
      isPremium?: boolean;
      hiddenSetId?: string;
    };
    forEmoji: {
      emoji?: string;
      stickers?: ApiSticker[];
      hash?: string;
    };
    diceSetIdByEmoji?: Record<string, string>;
  };

  customEmojis: {
    added: {
      hash?: string;
      setIds?: string[];
    };
    lastRendered: string[];
    byId: Record<string, ApiSticker>;
    forEmoji: {
      emoji?: string;
      stickers?: ApiSticker[];
    };
    featuredIds?: string[];
    statusRecent: {
      hash?: string;
      emojis?: ApiSticker[];
    };
  };

  animatedEmojis?: ApiStickerSet;
  animatedEmojiEffects?: ApiStickerSet;
  genericEmojiEffects?: ApiStickerSet;
  birthdayNumbers?: ApiStickerSet;
  restrictedEmoji?: ApiStickerSet;
  defaultTopicIconsId?: string;
  defaultStatusIconsId?: string;
  emojiKeywords: Record<string, EmojiKeywords | undefined>;

  emojiGroups: {
    hash?: number;
    groups?: ApiEmojiGroup[];
    stickerHash?: number;
    stickerGroups?: ApiEmojiGroup[];
  };

  collectibleEmojiStatuses?: {
    statuses: ApiEmojiStatusType[];
    hash?: string;
  };

  gifs: {
    saved: {
      hash?: string;
      gifs?: ApiVideo[];
    };
  };

  musicSearch: {
    audiosById: Record<string, ApiAudio>;
  };

  topPeerCategories: Partial<Record<ApiTopPeerCategory, {
    peerIds: string[];
    ratingsByPeerId: Record<string, number>;
    lastRequestedAt?: number;
    isDisabled?: boolean;
  }>>;

  activeSessions: {
    byHash: Record<string, ApiSession>;
    orderedHashes: string[];
    ttlDays?: number;
  };

  activeWebSessions: {
    byHash: Record<string, ApiWebSession>;
    orderedHashes: string[];
  };

  settings: {
    byKey: AccountSettings;
    loadedWallpapers?: ApiWallpaper[];
    chatThemes?: ApiChatTheme[];
    privacy: Partial<Record<ApiPrivacyKey, ApiPrivacySettings>>;
    notifyDefaults?: Record<ApiNotifyPeerType, ApiPeerNotifySettings>;
    lastPremiumBandwithNotificationDate?: number;
    botVerificationShownPeerIds: string[];
    accountDaysTtl: number;
    passkeys?: ApiPasskey[];
  };

  transcriptions: Record<string, ApiTranscription>;
  trustedBotIds: string[];

  serviceNotifications: ServiceNotification[];

  byTabId: Record<number, TabState>;
  sharedState: SharedState;

  archiveSettings: {
    isMinimized: boolean;
    isHidden: boolean;
  };

  translations: {
    byChatId: Record<string, ChatTranslatedMessages>;
  };

  savedReactionTags?: {
    byKey: Record<ApiReactionKey, ApiSavedReactionTag>;
    hash: string;
  };

};

export type RequiredGlobalState = GlobalState & { _: never };
export type ActionReturnType = GlobalState | void | Promise<void>;
export type TabArgs<T> = T extends RequiredGlobalState ? [
  tabId: number,
] : [
  tabId?: number | undefined,
];
