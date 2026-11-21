import type { API_CHAT_TYPES } from '../../config';
import type { ApiAudio, ApiFormattedText, ApiPhoto } from './messages';
import type { ApiPeerTheme, ApiWallpaper } from './misc';
import type {
  ApiEmojiStatusType,
  ApiFakeType,
  ApiPeerSettings,
  ApiProfileTab,
  ApiShareTheme,
  ApiTypePeerColor,
} from './peers';
import type { ApiStarsRating } from './stars';

export interface ApiUser {
  id: string;
  isMin: boolean;
  isSelf?: true;
  isVerified?: true;
  isPremium?: boolean;
  isCloseFriend?: boolean;
  isContact?: true;
  isSupport?: true;
  type: ApiUserType;
  firstName?: string;
  lastName?: string;
  noStatus?: boolean;
  usernames?: ApiUsername[];
  hasUsername?: boolean;
  phoneNumber: string;
  accessHash?: string;
  hasVideoAvatar?: boolean;
  avatarPhotoId?: string;
  fakeType?: ApiFakeType;
  emojiStatus?: ApiEmojiStatusType;
  areStoriesHidden?: boolean;
  hasStories?: boolean;
  hasUnreadStories?: boolean;
  maxStoryId?: number;
  color?: ApiTypePeerColor;
  profileColor?: ApiTypePeerColor;
}

export interface ApiUserFullInfo {
  peerTheme?: ApiPeerTheme;
  wallpaper?: ApiWallpaper;
  isBlocked?: boolean;
  ttlPeriod?: number;
  bio?: string;
  commonChatsCount?: number;
  pinnedMessageId?: number;
  profilePhoto?: ApiPhoto;
  fallbackPhoto?: ApiPhoto;
  personalPhoto?: ApiPhoto;
  noVoiceMessages?: boolean;
  hasPinnedStories?: boolean;
  isContactRequirePremium?: boolean;
  birthday?: ApiBirthday;
  personalChannelId?: string;
  personalChannelMessageId?: number;
  privateForwardName?: string;
  starsRating?: ApiStarsRating;
  starsMyPendingRating?: ApiStarsRating;
  starsMyPendingRatingDate?: number;
  hasScheduledMessages?: boolean;
  settings?: ApiPeerSettings;
  mainTab?: ApiProfileTab;
  savedMusic?: ApiAudio;
  note?: ApiFormattedText;
  noForwardsMyEnabled?: boolean;
  noForwardsPeerEnabled?: boolean;
  isUnofficialSecurityRisk?: boolean;
  shareTheme?: ApiShareTheme;
}

export type ApiUserType = 'userTypeRegular' | 'userTypeDeleted' | 'userTypeUnknown';

export interface ApiUserStatus {
  type: (
    'userStatusEmpty' | 'userStatusLastMonth' | 'userStatusLastWeek' |
    'userStatusOffline' | 'userStatusOnline' | 'userStatusRecently'
  );
  wasOnline?: number;
  expires?: number;
  isReadDateRestrictedByMe?: boolean;
  isReadDateRestricted?: boolean;
}

export interface ApiUserCommonChats {
  ids: string[];
  maxId?: string;
  isFullyLoaded: boolean;
}

export interface ApiUserSavedMusic {
  byId: Record<string, ApiAudio>;
  ids: string[];
  count: number;
  isFullyLoaded: boolean;
  isLoading?: boolean;
  isLoaded?: boolean;
}

export interface ApiUsername {
  username: string;
  isActive?: boolean;
  isEditable?: boolean;
}

export type ApiChatType = typeof API_CHAT_TYPES[number];
export type ApiInlineQueryPeerType = 'self' | 'supergroups' | ApiChatType;

export interface ApiBirthday {
  day: number;
  month: number;
  year?: number;
}
