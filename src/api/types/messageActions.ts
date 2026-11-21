import type {
  ApiPhoto, ApiPollAnswer, ApiVideo,
} from './messages';
import type { ApiWallpaper } from './misc';
import type { ApiBirthday } from './users';

interface ActionMediaType {
  mediaType: 'action';
}

export interface ApiMessageActionChatCreate extends ActionMediaType {
  type: 'chatCreate';
  title: string;
  userIds: string[];
}

export interface ApiMessageActionChatEditTitle extends ActionMediaType {
  type: 'chatEditTitle';
  title: string;
}

export interface ApiMessageActionChatEditPhoto extends ActionMediaType {
  type: 'chatEditPhoto';
  photo?: ApiPhoto;
}

export interface ApiMessageActionChatDeletePhoto extends ActionMediaType {
  type: 'chatDeletePhoto';
}

export interface ApiMessageActionChatAddUser extends ActionMediaType {
  type: 'chatAddUser';
  userIds: string[];
}

export interface ApiMessageActionChatDeleteUser extends ActionMediaType {
  type: 'chatDeleteUser';
  userId: string;
}

export interface ApiMessageActionChatJoinedByLink extends ActionMediaType {
  type: 'chatJoinedByLink';
  inviterId: string;
}

export interface ApiMessageActionPinMessage extends ActionMediaType {
  type: 'pinMessage';
}

export interface ApiMessageActionHistoryClear extends ActionMediaType {
  type: 'historyClear';
}

export interface ApiMessageActionSetMessagesTtl extends ActionMediaType {
  type: 'setMessagesTtl';
  period: number;
  autoSettingFromId?: string;
}

export interface ApiMessageActionSetChatTheme extends ActionMediaType {
  type: 'setChatTheme';
  emoticon?: string;
}

export interface ApiMessageActionSetChatWallpaper extends ActionMediaType {
  type: 'setChatWallpaper';
  isSame?: true;
  isForBoth?: true;
  wallpaper?: ApiWallpaper;
}

export interface ApiMessageActionScreenshotTaken extends ActionMediaType {
  type: 'screenshotTaken';
}

export interface ApiMessageActionCustomAction extends ActionMediaType {
  type: 'customAction';
  message: string;
}

export interface ApiMessageActionContactSignUp extends ActionMediaType {
  type: 'contactSignUp';
}

export interface ApiMessageActionChatJoinedByRequest extends ActionMediaType {
  type: 'chatJoinedByRequest';
}

export interface ApiMessageActionSuggestProfilePhoto extends ActionMediaType {
  type: 'suggestProfilePhoto';
  photo: ApiPhoto;
}

export interface ApiMessageActionSuggestBirthday extends ActionMediaType {
  type: 'suggestBirthday';
  birthday: ApiBirthday;
}

export interface ApiMessageActionExpiredContent extends ActionMediaType {
  type: 'expired';
  isVoice?: true;
  isRoundVideo?: true;
}

export interface ApiMessageActionPollAppendAnswer extends ActionMediaType {
  type: 'pollAppendAnswer';
  answer: ApiPollAnswer;
}

export interface ApiMessageActionPollDeleteAnswer extends ActionMediaType {
  type: 'pollDeleteAnswer';
  answer: ApiPollAnswer;
}

export interface ApiMessageActionNoForwardsToggle extends ActionMediaType {
  type: 'noForwardsToggle';
  prevValue: boolean;
  newValue: boolean;
}

export interface ApiMessageActionNoForwardsRequest extends ActionMediaType {
  type: 'noForwardsRequest';
  isExpired?: boolean;
  prevValue: boolean;
  newValue: boolean;
}

/** A change of a Signal group without a Telegram counterpart; the sender is who made it */
export interface ApiMessageActionGroupUpdate extends ActionMediaType {
  type: 'groupUpdate';
  update: 'description' | 'descriptionRemoved' | 'adminAdded' | 'adminRemoved' | 'invited' | 'inviteRevoked'
    | 'inviteDeclined' | 'joinRequested' | 'joinDenied' | 'joinCanceled' | 'linkOn' | 'linkOnWithApproval'
    | 'linkOff' | 'linkReset' | 'infoAccess' | 'membersAccess' | 'announcementsOn' | 'announcementsOff';
  userId?: string;
  count?: number;
  isAdminOnly?: boolean;
}

export interface ApiMessageActionUnsupported extends ActionMediaType {
  type: 'unsupported';
}

// Signal: the placeholder of a message its author or a group admin deleted for everyone
export interface ApiMessageActionDeleted extends ActionMediaType {
  type: 'deleted';
  // The group admin who deleted another member's message
  adminId?: string;
}

// Signal: view-once media, `isViewed` once it was opened on any of our devices. `media` is the photo or video of
// an incoming message not opened yet, which opens once in the media viewer.
export interface ApiMessageActionViewOnce extends ActionMediaType {
  type: 'viewOnce';
  isViewed?: true;
  media?: ApiPhoto | ApiVideo;
}

// Signal: the identity key of the sender (the contact) changed
export interface ApiMessageActionSafetyNumberChange extends ActionMediaType {
  type: 'safetyNumberChange';
}

// Signal: we marked the safety number with the sender (the contact) as verified or cleared it, here or on another device
export interface ApiMessageActionSafetyNumberVerified extends ActionMediaType {
  type: 'safetyNumberVerified';
  isVerified?: true;
  isFromOtherDevice?: true;
}

export type ApiMessageAction = ApiMessageActionUnsupported | ApiMessageActionDeleted | ApiMessageActionViewOnce
  | ApiMessageActionSafetyNumberChange | ApiMessageActionSafetyNumberVerified
  | ApiMessageActionChatCreate | ApiMessageActionChatEditTitle | ApiMessageActionGroupUpdate
  | ApiMessageActionChatEditPhoto | ApiMessageActionChatDeletePhoto | ApiMessageActionChatAddUser
  | ApiMessageActionChatDeleteUser | ApiMessageActionChatJoinedByLink | ApiMessageActionPinMessage
  | ApiMessageActionHistoryClear | ApiMessageActionSetMessagesTtl
  | ApiMessageActionSetChatTheme | ApiMessageActionSetChatWallpaper
  | ApiMessageActionScreenshotTaken | ApiMessageActionCustomAction
  | ApiMessageActionContactSignUp | ApiMessageActionExpiredContent
  | ApiMessageActionChatJoinedByRequest
  | ApiMessageActionSuggestProfilePhoto
  | ApiMessageActionSuggestBirthday
  | ApiMessageActionPollAppendAnswer | ApiMessageActionPollDeleteAnswer

  | ApiMessageActionNoForwardsToggle | ApiMessageActionNoForwardsRequest;
