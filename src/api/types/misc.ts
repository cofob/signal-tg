import type { CallbackAction } from '../../global/types';
import type { IconName } from '../../types/icons';
import type { MediaEditState, VideoProcessingParams, VideoQualityLevel } from '../../types/mediaEditor';
import type { AdvancedLangFnParameters, RegularLangFnParameters } from '../../util/localization';
import type {
  ApiDocument,
  ApiFormattedText,
  ApiMessageEntity,
  ApiPhoto,
  ApiReaction,
  ApiSticker,
  ApiVideo,
} from './messages';

export interface ApiInitialArgs {
  userAgent: string;
  platform?: string;
  langCode: string;
  // The tunnel for Signal hosts; `undefined` uses the build default
  signalProxyUrl?: string;
  // The key of the engine's stores, while a passcode exists (`getEngineKey` in `src/util/passcode`)
  storageKey?: ArrayBuffer;
  // The tunnel for connections without account credentials; `undefined` uses `signalProxyUrl`
  signalSealedSenderProxyUrl?: string;
}

export type ApiPasskeyOption = {
  publicKey: PublicKeyCredentialRequestOptionsJSON;
};

export interface ApiOnProgress {
  (
    progress: number, // Float between 0 and 1.
    ...args: any[]
  ): void;

  isCanceled?: boolean;
}

export interface ApiAttachment {
  blob?: Blob;
  blobUrl: string;
  compressedBlobUrl?: string;
  filename: string;
  mimeType: string;
  size: number;
  quick?: {
    width: number;
    height: number;
    duration?: number;
  };
  sourceDimensions?: {
    width: number;
    height: number;
  };
  voice?: {
    duration: number;
    waveform: number[];
  };
  audio?: {
    duration: number;
    title?: string;
    performer?: string;
  };
  previewBlobUrl?: string;

  isPreparing?: true;

  shouldSendAsFile?: true;
  shouldSendAsSpoiler?: true;

  uniqueId: string;
  ttlSeconds?: number;
  isRoundVideo?: boolean;
  shouldSendInHighQuality?: boolean;
  editState?: MediaEditState;
  videoProcessing?: VideoProcessingParams;
  videoQualityLevel?: VideoQualityLevel;
  shouldSendAsGif?: true;
  attachedStickers?: ApiSticker[];
  isFromMessageMedia?: true;
  sourceBlobUrl?: string;
  videoCover?: {
    blobUrl: string;
    width: number;
    height: number;
  };

  gif?: ApiVideo;
}

export interface ApiAvatarUpload {
  file: File;
  video?: File;
  videoStartTs?: number;
}

export interface ApiWallpaperSettings {
  backgroundColor?: number;
  secondBackgroundColor?: number;
  thirdBackgroundColor?: number;
  fourthBackgroundColor?: number;
  intensity?: number;
  rotation?: number;
  // Set on chat-theme wallpapers (links the wallpaper to its chat theme)
  emoticon?: string;
  isBlurred?: boolean;
  isMoving?: boolean;
}

export interface ApiWallpaper {
  slug: string;
  document?: ApiDocument;
  isPattern?: boolean;
  isDark?: boolean;
  isCreator?: boolean;
  isDefault?: boolean;
  settings?: ApiWallpaperSettings;
}

export type ApiBaseTheme = 'classic' | 'day' | 'night' | 'tinted';

export interface ApiThemeSettings {
  baseTheme: ApiBaseTheme;
  accentColor: string;
  outgoingColors?: string[];
  areOutgoingColorsAnimated?: boolean;
  outboxAccentColor?: string;
  wallpaper?: ApiWallpaper;
}

export interface ApiChatTheme {
  emoticon: string;
  isDefault?: boolean;
  settings: ApiThemeSettings[];
}

export type ApiPeerTheme = {
  type: 'emoticon';
  emoticon: string;
};

// The engine keeps its keys in its own store, so the session only marks the account slot as linked
export interface ApiSessionData {
  isLinked: true;
}

export type ApiNotification = {
  localId: string;
  containerSelector?: string;
  title?: string | AdvancedLangFnParameters;
  cacheBreaker?: string;
  actionText?: string | AdvancedLangFnParameters;
  action?: CallbackAction | CallbackAction[];
  // A second button below `actionText`
  secondaryActionText?: string | AdvancedLangFnParameters;
  secondaryAction?: CallbackAction | CallbackAction[];
  className?: string;
  duration?: number;
  disableClickDismiss?: boolean;
  shouldShowTimer?: boolean;
  icon?: IconName;
  customEmojiIconId?: string;
  dismissAction?: CallbackAction;
} & ({
  message: string;
  messageEntities?: ApiMessageEntity[];
} | {
  message: AdvancedLangFnParameters;
  messageEntities?: undefined;
});

export type ApiDialogError = {
  type: 'error';
} & ApiError;

export type ApiDialogMessage = {
  type: 'message';
  title?: string;
  text: ApiFormattedText;
};

export type ApiDialogLocalizedMessage = {
  type: 'localized';
  title?: RegularLangFnParameters;
  text: AdvancedLangFnParameters;
};

export type ApiDialog = ApiDialogError | ApiDialogMessage | ApiDialogLocalizedMessage;

export type ApiError = {
  message: string;
  code?: number;
  entities?: ApiMessageEntity[];
  hasErrorKey?: boolean;
  isSlowMode?: boolean;
  textParams?: Record<string, string>;
};

export type ApiExportedInvite = {
  isRevoked?: boolean;
  isPermanent?: boolean;
  link: string;
  date: number;
  startDate?: number;
  expireDate?: number;
  usageLimit?: number;
  usage?: number;
  isRequestNeeded?: boolean;
  requested?: number;
  title?: string;
  adminId: string;
};

export type ApiChatInviteInfo = {
  title: string;
  about?: string;
  photo?: ApiPhoto;
  isScam?: boolean;
  isFake?: boolean;
  isChannel?: boolean;
  isVerified?: boolean;
  isSuperGroup?: boolean;
  isPublic?: boolean;
  participantsCount?: number;
  participantIds?: string[];
  color: number;
  isBroadcast?: boolean;
  isRequestNeeded?: boolean;
};

export type ApiChatInviteImporter = {
  userId: string;
  date: number;
  isRequested?: boolean;
  about?: string;
  isFromChatList?: boolean;
};

export interface ApiCountry {
  isHidden?: boolean;
  iso2: string;
  defaultName: string;
  name?: string;
}

export interface ApiCountryCode extends ApiCountry {
  countryCode: string;
  prefixes?: string[];
  patterns?: string[];
}

export interface ApiAppConfig {
  hash: number;
  emojiSounds: Record<string, string>;
  seenByMaxChatMembers: number;
  seenByExpiresAt: number;
  readDateExpiresAt: number;
  autologinDomains: string[];
  whitelistedDomains: string[];
  defaultEmojiStatusesStickerSetId: string;
  maxUniqueReactions: number;
  topicsPinnedLimit: number;
  hiddenMembersMinCount: number;
  richMessageLengthLimit: number;
  richMessageMaxBlocks: number;
  richMessageMaxDepth: number;
  richMessageMaxMedia: number;
  richMessageMaxTableColumns: number;
  canDisplayAutoarchiveSetting?: boolean;
  storyViewersExpirePeriod: number;
  maxPinnedStoriesCount: number;
  starsUsdWithdrawRateX1000: number;
  starsUsdSellRateX1000?: number;
  channelAutoTranslationLevelMin?: number;
  tonExplorerUrl?: string;
  freezeSinceDate?: number;
  freezeUntilDate?: number;
  freezeAppealUrl?: string;
  noForwardsRequestExpirePeriod: number;
  tonUsdRate?: number;
  tonTopupUrl?: string;
  pollMaxAnswers: number;
  pollClosePeriodMax: number;
  pollCountriesMax: number;
  phoneCountryIso2?: string;
  quoteLengthMax: number;
  ignoreRestrictionReasons?: string[];
  needAgeVideoVerification?: boolean;
  verifyAgeBotUsername?: string;
  verifyAgeCountry?: string;
  verifyAgeMin?: number;
  typingDraftTtl: number;
  isMessagePrimaryEditedDateEnabled: boolean;
  contactNoteLimit?: number;
  diceEmojies: string[];
  diceEmojiesSuccess: Record<string, {
    value: number;
    frameStart: number;
  }>;
}

export interface ApiConfig {
  expiresAt: number;
  defaultReaction?: ApiReaction;
  gifSearchUsername?: string;
  maxGroupSize: number;
  autologinToken?: string;
  maxMessageLength: number;
  editTimeLimit: number;
  maxForwardedCount: number;
  ratingEDecay: number;
}

export type ApiTopPeerCategory = 'correspondents';

export type ApiTopPeer = {
  peerId: string;
  rating: number;
};

export type ApiTopPeersResult = {
  type: 'topPeers';
  category: ApiTopPeerCategory;
  topPeers: ApiTopPeer[];
} | {
  type: 'unchanged';
} | {
  type: 'disabled';
};

export interface ApiPromoData {
  expires: number;
  pendingSuggestions: string[];
  dismissedSuggestions: string[];
  customPendingSuggestion?: ApiPendingSuggestion;
}

export interface ApiPendingSuggestion {
  suggestion: string;
  title: ApiFormattedText;
  description: ApiFormattedText;
  url: string;
}

export interface ApiEmojiInteraction {
  timestamps: number[];
}

export type ApiLimitType =
  | 'uploadMaxFileparts'
  | 'stickersFaved'
  | 'savedGifs'
  | 'dialogFiltersChats'
  | 'dialogFilters'
  | 'dialogFolderPinned'
  | 'messageLength'
  | 'captionLength'
  | 'aboutLength'
  | 'maxReactions'
  | 'moreAccounts';

export type ApiLimitTypeWithModal = Exclude<ApiLimitType, (
  'messageLength' | 'captionLength' | 'aboutLength' | 'stickersFaved' | 'savedGifs'
  | 'moreAccounts'
  | 'maxReactions'
)>;

export type ApiPeerNotifySettings = {
  mutedUntil?: number;
  hasSound?: boolean;
  isSilentPosting?: boolean;
  shouldShowPreviews?: boolean;
};

export type ApiNotifyPeerType = 'users' | 'groups';

export interface ApiRestrictionReason {
  reason: string;
  text: string;
  platform: string;
}

export type ApiEmojiGroup = {
  title: string;
  iconEmojiId: string;
  emoticons: string[];
};
