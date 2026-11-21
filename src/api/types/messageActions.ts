import type { ApiGroupCall, ApiPhoneCallDiscardReason } from './calls';
import type {
  ApiBotApp, ApiPhoto, ApiPollAnswer, ApiVideo,
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

export interface ApiMessageActionChatJoinedViaCommunity extends ActionMediaType {
  type: 'chatJoinedViaCommunity';
  communityId: string;
}

export interface ApiMessageActionChannelCreate extends ActionMediaType {
  type: 'channelCreate';
  title: string;
}

export interface ApiMessageActionChatMigrateTo extends ActionMediaType {
  type: 'chatMigrateTo';
  channelId: string;
}

export interface ApiMessageActionChannelMigrateFrom extends ActionMediaType {
  type: 'channelMigrateFrom';
  title: string;
  chatId: string;
}

export interface ApiMessageActionChangeCommunity extends ActionMediaType {
  type: 'changeCommunity';
  communityId?: string;
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

export interface ApiMessageActionGameScore extends ActionMediaType {
  type: 'gameScore';
  gameId: string;
  score: number;
}

export interface ApiMessageActionPhoneCall extends ActionMediaType {
  type: 'phoneCall';
  isVideo?: true;
  callId: string;
  reason?: ApiPhoneCallDiscardReason;
  duration?: number;
}

export interface ApiMessageActionScreenshotTaken extends ActionMediaType {
  type: 'screenshotTaken';
}

export interface ApiMessageActionCustomAction extends ActionMediaType {
  type: 'customAction';
  message: string;
}

export interface ApiMessageActionBotAllowed extends ActionMediaType {
  type: 'botAllowed';
  isAttachMenu?: true;
  isFromRequest?: true;
  domain?: string;
  app?: ApiBotApp;
}

export interface ApiMessageActionRequestedPeer extends ActionMediaType {
  type: 'requestedPeer';
  peerIds: string[];
}

export interface ApiMessageActionManagedBotCreated extends ActionMediaType {
  type: 'managedBotCreated';
  botId: string;
}

export interface ApiMessageActionContactSignUp extends ActionMediaType {
  type: 'contactSignUp';
}

export interface ApiMessageActionGroupCall extends ActionMediaType {
  type: 'groupCall';
  call: Pick<ApiGroupCall, 'id' | 'accessHash'>;
  duration?: number;
}

export interface ApiMessageActionInviteToGroupCall extends ActionMediaType {
  type: 'inviteToGroupCall';
  call: Pick<ApiGroupCall, 'id' | 'accessHash'>;
  userIds: string[];
}

export interface ApiMessageActionGroupCallScheduled extends ActionMediaType {
  type: 'groupCallScheduled';
  call: Pick<ApiGroupCall, 'id' | 'accessHash'>;
  scheduleDate: number;
}

export interface ApiMessageActionChatJoinedByRequest extends ActionMediaType {
  type: 'chatJoinedByRequest';
}

export interface ApiMessageActionWebViewDataSent extends ActionMediaType {
  type: 'webViewDataSent';
  text: string;
}

export interface ApiMessageActionTopicCreate extends ActionMediaType {
  type: 'topicCreate';
  title: string;
  iconColor: number;
  iconEmojiId?: string;
}

export interface ApiMessageActionTopicEdit extends ActionMediaType {
  type: 'topicEdit';
  title?: string;
  iconEmojiId?: string;
  isClosed?: boolean;
  isHidden?: boolean;
}

export interface ApiMessageActionSuggestProfilePhoto extends ActionMediaType {
  type: 'suggestProfilePhoto';
  photo: ApiPhoto;
}

export interface ApiMessageActionSuggestBirthday extends ActionMediaType {
  type: 'suggestBirthday';
  birthday: ApiBirthday;
}

export interface ApiMessageActionChannelJoined extends ActionMediaType {
  type: 'channelJoined';
  isViaRequest?: true;
  inviterId?: string;
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

export interface ApiMessageActionNewCreatorPending extends ActionMediaType {
  type: 'newCreatorPending';
  newCreatorId: string;
}

export interface ApiMessageActionChangeCreator extends ActionMediaType {
  type: 'changeCreator';
  newCreatorId: string;
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
  | ApiMessageActionChatDeleteUser | ApiMessageActionChatJoinedByLink | ApiMessageActionChannelCreate
  | ApiMessageActionChatMigrateTo | ApiMessageActionChannelMigrateFrom | ApiMessageActionPinMessage
  | ApiMessageActionHistoryClear | ApiMessageActionSetMessagesTtl
  | ApiMessageActionSetChatTheme | ApiMessageActionSetChatWallpaper
  | ApiMessageActionGameScore | ApiMessageActionPhoneCall
  | ApiMessageActionScreenshotTaken | ApiMessageActionCustomAction | ApiMessageActionBotAllowed
  | ApiMessageActionContactSignUp | ApiMessageActionExpiredContent
  | ApiMessageActionRequestedPeer | ApiMessageActionManagedBotCreated
  | ApiMessageActionGroupCall | ApiMessageActionInviteToGroupCall | ApiMessageActionGroupCallScheduled
  | ApiMessageActionChatJoinedByRequest | ApiMessageActionChatJoinedViaCommunity
  | ApiMessageActionWebViewDataSent
  | ApiMessageActionTopicCreate | ApiMessageActionTopicEdit | ApiMessageActionSuggestProfilePhoto
  | ApiMessageActionSuggestBirthday
  | ApiMessageActionChannelJoined
  | ApiMessageActionPollAppendAnswer | ApiMessageActionPollDeleteAnswer

  | ApiMessageActionNewCreatorPending
  | ApiMessageActionChangeCreator | ApiMessageActionNoForwardsToggle | ApiMessageActionNoForwardsRequest
  | ApiMessageActionChangeCommunity;
