import type {
  ApiChatReactions, ApiFormattedText, ApiInputDraftReplyInfo, ApiPhoto,
} from './messages';
import type { ApiChatInviteImporter, ApiPeerTheme, ApiRestrictionReason, ApiWallpaper } from './misc';
import type {
  ApiPeerSettings,
  ApiTypePeerColor,
} from './peers';
import type { ApiInputRichMessage } from './richMessage';
import type {
  ApiUser, ApiUsername,
} from './users';

type ApiChatType = 'chatTypePrivate' | 'chatTypeBasicGroup';

export type ApiPeer = ApiChat | ApiUser;

// Signal: the join request of a group link that needs admin approval was sent
export type ApiChatInviteJoinRequested = {
  type: 'requested';
};

export interface ApiChat {
  id: string;
  folderId?: number;
  type: ApiChatType;
  title: string;
  accessHash?: string;
  isMin?: boolean;
  hasVideoAvatar?: boolean;
  avatarPhotoId?: string;
  usernames?: ApiUsername[];
  hasUsername?: boolean;
  membersCount?: number;
  creationDate?: number;
  isSupport?: true;
  isProtected?: boolean;
  color?: ApiTypePeerColor;
  profileColor?: ApiTypePeerColor;

  // Current user permissions
  isNotJoined?: boolean;
  isListed?: boolean;
  isOwner?: boolean;
  isForbidden?: boolean; // Forbidden - can't send messages (user was kicked, for example)
  isRestricted?: boolean; // Restricted - can't access the chat (user was banned or chat is violating rules)
  restrictionReasons?: ApiRestrictionReason[];
  adminRights?: ApiChatAdminRights;
  currentUserBannedRights?: ApiChatBannedRights;
  defaultBannedRights?: ApiChatBannedRights;

  joinRequests?: ApiChatInviteImporter[];
  isJoinRequest?: boolean;

  // Stories
  areStoriesHidden?: boolean;
  hasStories?: boolean;
  hasUnreadStories?: boolean;
  maxStoryId?: number;

  // Locally determined field

  ttlPeriod?: number;
}

type ApiTypingStatusBase = {
  timestamp: number;
};

type ApiTypingStatusSimple = ApiTypingStatusBase & {
  type: 'typing' | 'recordVideo' | 'uploadVideo' | 'recordAudio' | 'uploadAudio'
    | 'uploadPhoto' | 'uploadFile' | 'recordRound' | 'uploadRound'
    | 'chooseSticker' | 'chooseContact';
};

type ApiTypingStatusWatchingAnimations = ApiTypingStatusBase & {
  type: 'watchingAnimations';
  emoji: string;
};

export type ApiTypingStatus = ApiTypingStatusSimple | ApiTypingStatusWatchingAnimations;

export interface ApiChatFullInfo {
  // The chat header bar of a group message request
  settings?: ApiPeerSettings;
  peerTheme?: ApiPeerTheme;
  wallpaper?: ApiWallpaper;
  isCache?: boolean;
  about?: string;
  ttlPeriod?: number;
  enabledReactions?: ApiChatReactions;
  members?: ApiChatMember[];
  kickedMembers?: ApiChatMember[];
  adminMembersById?: Record<string, ApiChatMember>;
  canViewMembers?: boolean;
  isPreHistoryHidden?: boolean;
  inviteLink?: string;
  slowMode?: {
    seconds: number;
    nextSendDate?: number;
  };
  joinInfo?: {
    joinedDate: number;
    inviterId?: string;
    isViaRequest?: boolean;
  };
  recentRequesterIds?: string[];
  requestsPending?: number;
  profilePhoto?: ApiPhoto;
  hasPinnedStories?: boolean;
  hasScheduledMessages?: boolean;

}

export interface ApiChatMember {
  userId: string;
  rank?: string;
  inviterId?: string;
  joinedDate?: number;
  kickedByUserId?: string;
  promotedByUserId?: string;
  bannedRights?: ApiChatBannedRights;
  adminRights?: ApiChatAdminRights;
  isAdmin?: true;
  isOwner?: true;
  isViaRequest?: true;
}

export interface ApiChatAdminRights {
  changeInfo?: true;
  postMessages?: true;
  editMessages?: true;
  deleteMessages?: true;
  banUsers?: true;
  inviteUsers?: true;
  pinMessages?: true;
  addAdmins?: true;
  anonymous?: true;
  other?: true;
  manageCall?: true;
  postStories?: true;
  editStories?: true;
  deleteStories?: true;
  manageDirectMessages?: true;
  manageRanks?: true;
  manageLinkedPeers?: true;
  manageWelcomeMessages?: true;
}

export interface ApiChatBannedRights {
  viewMessages?: true;
  sendMessages?: true;
  sendMedia?: true;
  sendStickers?: true;
  sendGifs?: true;
  sendGames?: true;
  sendInline?: true;
  embedLinks?: true;
  sendPolls?: true;
  changeInfo?: true;
  inviteUsers?: true;
  pinMessages?: true;
  sendPhotos?: true;
  sendVideos?: true;
  sendRoundvideos?: true;
  sendAudios?: true;
  sendVoices?: true;
  sendDocs?: true;
  sendPlain?: true;
  editRank?: true;
  sendReactions?: true;
  untilDate?: number;
}

export interface ApiChatFolder {
  id: number;
  title: ApiFormattedText;
  noTitleAnimations?: true;
  emoticon?: string;
  contacts?: true;
  nonContacts?: true;
  groups?: true;
  channels?: true;
  excludeMuted?: true;
  excludeRead?: true;
  excludeArchived?: true;
  pinnedChatIds?: string[];
  includedChatIds: string[];
  excludedChatIds: string[];
}

export interface ApiMissingInvitedUser {
  id: string;
}

export type ApiDraft = {
  text?: ApiFormattedText;
  richMessage?: ApiInputRichMessage;
  replyInfo?: ApiInputDraftReplyInfo;
  date?: number;
  isLocal?: boolean;
};
