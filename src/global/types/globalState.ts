import type {
  ApiAppConfig,
  ApiAudio,
  ApiAuthCodeInfo,
  ApiAvailableReaction,
  ApiCallLogEntry,
  ApiChat,
  ApiChatFolder,
  ApiChatFullInfo,
  ApiChatTheme,
  ApiConfig,
  ApiCountry,
  ApiCountryCode,
  ApiEmojiGroup,
  ApiGroupCall,
  ApiHistorySyncProgress,
  ApiMessage,
  ApiMessagePoll,
  ApiNotifyPeerType,
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
  ApiShareThemeBackdrop,
  ApiSticker,
  ApiStickerSet,
  ApiStoryAlbum,
  ApiStoryDistributionList,
  ApiStorySettings,
  ApiTopPeerCategory,
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
} from '../../api/types';
import type {
  AccountSettings,
  AttachmentCompression,
  ChatListType,
  EmojiKeywords,
  OrderMode,
  RepeatMode,
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
  isCacheApiSupported?: boolean;
  connectionState?: ApiUpdateConnectionStateType;
  currentUserId?: string;
  isSyncing?: boolean;
  isAppConfigLoaded?: boolean;
  isAppUpdateAvailable?: boolean;
  isSynced?: boolean;
  isFetchingDifference?: boolean;
  leftColumnWidth?: number;
  lastIsChatInfoShown?: boolean;
  initialUnreadNotifications?: number;
  shouldShowContextMenuHint?: boolean;
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

  attachmentSettings: {
    shouldCompress: boolean;
    defaultAttachmentCompression: AttachmentCompression;
    shouldSendGrouped: boolean;
    isInvertedMedia?: true;
    webPageMediaSize?: WebPageMediaSize;
    shouldSendInHighQuality?: boolean;
  };

  mediaEditorSettings?: MediaEditorSettings;

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
    qrCode?: {
      token: string;
      expires: number;
    };
    historySync?: ApiHistorySyncProgress;

  };
  countryList: {
    phoneCodes: ApiCountryCode[];
    general: ApiCountry[];
  };

  contactList?: {
    userIds: string[];
  };

  // Signal: the call history, newest first; loaded when the call log opens and replaced on changes
  callLog?: ApiCallLogEntry[];

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
    commonChatsById: Record<string, ApiUserCommonChats>;
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

    personalChannelIds?: string[];
  };

  messages: {
    byChatId: Record<string, {
      byId: Record<number, ApiMessage>;
      ephemeralById: Record<number, ApiMessage>;
      anchoredById: Record<number, ApiMessage>;
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
    recommended?: ApiChatFolder[];
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
    featured: {
      hash?: string;
      setIds?: string[];
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

  settings: {
    byKey: AccountSettings;
    loadedWallpapers?: ApiWallpaper[];
    chatThemes?: ApiChatTheme[];
    privacy: Partial<Record<ApiPrivacyKey, ApiPrivacySettings>>;
    notifyDefaults?: Record<ApiNotifyPeerType, ApiPeerNotifySettings>;
    accountDaysTtl: number;
  };

  byTabId: Record<number, TabState>;
  sharedState: SharedState;

  archiveSettings: {
    isMinimized: boolean;
    isHidden: boolean;
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
