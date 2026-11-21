import type { API_CHAT_TYPES } from '../../config';
import type { ApiChat } from './chats';
import type { ApiAudio, ApiFormattedText, ApiPhoto } from './messages';
import type { ApiPeerTheme, ApiWallpaper } from './misc';
import type {
  ApiEmojiStatus,
  ApiFakeType,
  ApiPeerSettings,
  ApiProfileTab,
  ApiTypePeerColor,
} from './peers';

/** A Signal user found by phone number, or why none was */
export type ApiPhoneNumberLookup = { chat: ApiChat; user: ApiUser }
  | { error: 'notFound' | 'rateLimited' | 'unavailable' };

export interface ApiUser {
  id: string;
  isMin: boolean;
  isSelf?: true;
  isVerified?: true;
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
  emojiStatus?: ApiEmojiStatus;
  areStoriesHidden?: boolean;
  hasStories?: boolean;
  hasUnreadStories?: boolean;
  maxStoryId?: number;
  color?: ApiTypePeerColor;
  profileColor?: ApiTypePeerColor;
}

// Signal: the chat color (the background of own messages) and wallpaper of a chat, as CSS backgrounds
export interface ApiSignalChatStyle {
  bubbleColor?: string;
  wallpaper?: string;
}

export interface ApiUserFullInfo {
  // Signal: shown only; the colors are not in the storage service, so they are not changed here
  signalChatStyle?: ApiSignalChatStyle;
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
  birthday?: ApiBirthday;
  personalChannelId?: string;
  personalChannelMessageId?: number;
  privateForwardName?: string;
  hasScheduledMessages?: boolean;
  settings?: ApiPeerSettings;
  mainTab?: ApiProfileTab;
  savedMusic?: ApiAudio;
  note?: ApiFormattedText;
  noForwardsMyEnabled?: boolean;
  noForwardsPeerEnabled?: boolean;
  isUnofficialSecurityRisk?: boolean;
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
