import type { ApiAppConfig, ApiLimitType } from './api/types';

import { MAX_UPLOAD_FILEPART_SIZE } from './config';

export const GROUP_CALL_PARTICIPANTS_LIMIT = 100;
export const STORY_LIST_LIMIT = 100;
export const API_GENERAL_ID_LIMIT = 100;
export const PINNED_MESSAGES_LIMIT = 50;
export const BLOCKED_LIST_LIMIT = 100;
export const GLOBAL_SEARCH_CONTACTS_LIMIT = 20;

// As in Telegram for Android
// https://github.com/DrKLO/Telegram/blob/51e9947527/TMessagesProj/src/main/java/org/telegram/messenger/MediaDataController.java#L7799
export const TOP_REACTIONS_LIMIT = 100;
export const RECENT_REACTIONS_LIMIT = 50;
export const REACTION_LIST_LIMIT = 100;

// Limits the client enforces, with the values of a regular Telegram account
export const LIMITS = {
  uploadMaxFileparts: 4000,
  stickersFaved: 5,
  savedGifs: 200,
  dialogFiltersChats: 100,
  dialogFilters: 10,
  // Signal pins up to 4 chats
  dialogFolderPinned: 4,
  messageLength: 4096,
  captionLength: 1024,
  channels: 500,
  channelsPublic: 10,
  aboutLength: 70,
  chatlistInvites: 3,
  chatlistJoined: 2,
  savedDialogsPinned: 5,
  maxReactions: 1,
  moreAccounts: 3,
  botsCreate: 20,
} as const satisfies Record<ApiLimitType, number>;

// The "All chats" folder does not count toward `LIMITS.dialogFilters`
export const MAX_FOLDERS = LIMITS.dialogFilters + 1;
export const MAX_UPLOAD_SIZE = LIMITS.uploadMaxFileparts * MAX_UPLOAD_FILEPART_SIZE;

export const DEFAULT_MAX_NOTE_LENGTH = 128;

export const DEFAULT_APP_CONFIG: ApiAppConfig = {
  hash: 0,
  richMessageLengthLimit: 32768,
  richMessageMaxBlocks: 500,
  richMessageMaxDepth: 16,
  richMessageMaxMedia: 50,
  richMessageMaxTableColumns: 20,
  autologinDomains: [],
  seenByExpiresAt: 604800,
  seenByMaxChatMembers: 100,
  defaultEmojiStatusesStickerSetId: '773947703670341676',
  emojiSounds: {},
  hiddenMembersMinCount: 100,
  ignoreRestrictionReasons: [],
  readDateExpiresAt: 604800,
  maxUniqueReactions: 11,
  starsUsdWithdrawRateX1000: 1300,
  storyChangelogUserId: '777000',
  maxPinnedStoriesCount: 3,
  pollMaxAnswers: 12,
  pollClosePeriodMax: 2628000,
  pollCountriesMax: 10,
  noForwardsRequestExpirePeriod: 86400,
  quoteLengthMax: 1024,
  storyViewersExpirePeriod: 86400,
  topicsPinnedLimit: 5,
  urlAuthDomains: [],
  webAppAllowedProtocols: [
    'http',
    'https',
  ],
  whitelistedDomains: [],
  typingDraftTtl: 10,
  isMessagePrimaryEditedDateEnabled: false,
  arePasskeysAvailable: true,
  passkeysMaxCount: 5,
  diceEmojies: [],
  diceEmojiesSuccess: {},
};
