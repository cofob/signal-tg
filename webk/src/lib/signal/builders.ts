/*
 * TeleSignal: the Web K shapes (`@layer`) of what the Signal provider returns (`@signal-app/provider`).
 * The provider's peer ids are small: a private conversation is the user `localId`, a group the basic group
 * `localId` (peer id `-localId`). Web K reads small ids as its own (folder ids, the service and reply peers), so its
 * ids are the provider's moved by `PEER_ID_OFFSET`. Message ids are the ids of the engine's message database, unique
 * across chats, as Telegram's ids of private chats and basic groups are.
 */

import type {
  Chat,
  Dialog,
  Message,
  MessageAction,
  MessageEntity,
  Peer,
  PeerNotifySettings,
  User,
  UserProfilePhoto,
  ChatPhoto
} from '@layer';
import type {
  SignalChat,
  SignalEntity,
  SignalMessage,
  SignalNotifySettings,
  SignalReadState,
  SignalUser
} from '@lib/signal/signalApi';

// * Web A's `ARCHIVED_FOLDER_ID`, which Web K's folder of archived chats has too
const ARCHIVED_FOLDER_ID = 1;
const PEER_ID_OFFSET = 1e10;

/** Web K's peer id of a provider peer id */
export function toPeerId(signalPeerId: string | number): PeerId {
  const id = +signalPeerId;
  return (id < 0 ? id - PEER_ID_OFFSET : id + PEER_ID_OFFSET) as PeerId;
}

/** The provider's peer id of a Web K peer id */
export function toSignalPeerId(peerId: PeerId | string | number) {
  const id = +peerId;
  return '' + (id < 0 ? id + PEER_ID_OFFSET : id - PEER_ID_OFFSET);
}

export function isGroupPeerId(peerId: string | number) {
  return +peerId < 0;
}

export function buildPeer(signalPeerId: string | number): Peer {
  const id = toPeerId(signalPeerId);
  return id < 0 ? {_: 'peerChat', chat_id: -id} : {_: 'peerUser', user_id: id};
}

export function buildUser(user: SignalUser): User.user {
  const username = user.usernames?.find(({isActive}) => isActive)?.username;
  return {
    _: 'user',
    pFlags: {
      self: user.isSelf,
      contact: user.isContact
    },
    id: toPeerId(user.id),
    access_hash: '0',
    first_name: user.firstName,
    last_name: user.lastName,
    phone: user.phoneNumber || undefined,
    username,
    photo: buildUserPhoto(user.avatarPhotoId),
    status: {_: 'userStatusEmpty'},
    color: user.color?.color !== undefined ? {_: 'peerColor', color: user.color.color} : undefined
  };
}

/** Groups only: a private conversation is its user (`buildUser`) */
export function buildChat(chat: SignalChat): Chat.chat {
  return {
    _: 'chat',
    pFlags: {
      creator: chat.isOwner || undefined,
      left: chat.isForbidden || undefined
    },
    id: -toPeerId(chat.id),
    title: chat.title,
    photo: buildChatPhoto(chat.avatarPhotoId),
    participants_count: chat.membersCount || 0,
    date: chat.creationDate || 0,
    version: 0
  };
}

export function buildDialog({chat, readState, topMessageId, notifySettings, isPinned}: {
  chat: SignalChat,
  readState?: SignalReadState,
  topMessageId?: number,
  notifySettings?: SignalNotifySettings,
  isPinned?: boolean
}): Dialog.dialog {
  return {
    _: 'dialog',
    pFlags: {
      pinned: isPinned || undefined,
      unread_mark: readState?.hasUnreadMark || undefined
    },
    peer: buildPeer(chat.id),
    top_message: topMessageId || 0,
    read_inbox_max_id: readState?.lastReadInboxMessageId || 0,
    read_outbox_max_id: readState?.lastReadOutboxMessageId || 0,
    unread_count: readState?.unreadCount || 0,
    unread_mentions_count: 0,
    unread_reactions_count: 0,
    unread_poll_votes_count: 0,
    notify_settings: buildNotifySettings(notifySettings),
    folder_id: chat.folderId === ARCHIVED_FOLDER_ID ? 1 : 0,
    ttl_period: chat.ttlPeriod
  };
}

export function buildNotifySettings(settings?: SignalNotifySettings): PeerNotifySettings.peerNotifySettings {
  return {
    _: 'peerNotifySettings',
    mute_until: settings?.mutedUntil,
    show_previews: settings?.shouldShowPreviews
  };
}

export function buildMessage(message: SignalMessage): Message.message | Message.messageService {
  const peerId = buildPeer(message.chatId);
  const fromId = message.senderId ? buildPeer(message.senderId) : undefined;
  const pFlags: Message.message['pFlags'] = {
    out: message.isOutgoing || undefined
  };

  const {action} = message.content;
  if(action) {
    return {
      _: 'messageService',
      pFlags,
      id: message.id,
      peer_id: peerId,
      from_id: fromId,
      date: message.date,
      action: buildMessageAction(action)
    };
  }

  const {text} = message.content;
  return {
    _: 'message',
    pFlags,
    id: message.id,
    peer_id: peerId,
    from_id: fromId,
    date: message.date,
    message: text?.text || '',
    entities: text?.entities?.map(buildEntity).filter(Boolean),
    media: getHasUnsupportedMedia(message) ? {_: 'messageMediaUnsupported'} : undefined,
    reply_to: message.replyInfo?.replyToMsgId ? {
      _: 'messageReplyHeader',
      pFlags: {},
      reply_to_msg_id: message.replyInfo.replyToMsgId
    } : undefined,
    edit_date: message.isEdited ? message.editDate || message.date : undefined,
    ttl_period: message.ttlPeriod,
    grouped_id: message.groupedId
  };
}

function getHasUnsupportedMedia(message: SignalMessage) {
  const {photo, video, document, sticker, voice, audio, contact, pollId} = message.content;
  return Boolean(photo || video || document || sticker || voice || audio || contact || pollId);
}

// * Web A's `ApiMessageEntityTypes` are the TL names with an upper-case first letter
function buildEntity(entity: SignalEntity): MessageEntity {
  const {type, offset, length} = entity;
  const name = (type.charAt(0).toLowerCase() + type.slice(1)) as MessageEntity['_'];
  switch(name) {
    case 'messageEntityTextUrl':
      return {_: name, offset, length, url: entity.url};
    case 'messageEntityMentionName':
      return {_: name, offset, length, user_id: toPeerId(entity.userId)};
    case 'messageEntityPre':
      return {_: name, offset, length, language: entity.language || ''};
    case 'messageEntityBold':
    case 'messageEntityItalic':
    case 'messageEntityUnderline':
    case 'messageEntityStrike':
    case 'messageEntityCode':
    case 'messageEntitySpoiler':
    case 'messageEntityUrl':
    case 'messageEntityEmail':
    case 'messageEntityPhone':
    case 'messageEntityMention':
    case 'messageEntityHashtag':
      return {_: name, offset, length} as MessageEntity;
    default:
      return undefined;
  }
}

function buildMessageAction(action: SignalMessage['content']['action']): MessageAction {
  switch(action.type) {
    case 'setMessagesTtl':
      return {_: 'messageActionSetMessagesTTL', period: (action.period as number) || 0};
    case 'chatCreate':
      return {_: 'messageActionChatCreate', title: (action.title as string) || '', users: []};
    case 'chatEditTitle':
      return {_: 'messageActionChatEditTitle', title: (action.title as string) || ''};
    default:
      // * the notices Signal has and Telegram has not (safety numbers, calls, group access) show as text
      return {_: 'messageActionCustomAction', message: getActionText(action)};
  }
}

function getActionText(action: SignalMessage['content']['action']) {
  switch(action.type) {
    case 'safetyNumberChange':
      return 'Your safety number changed';
    case 'safetyNumberVerified':
      return action.isVerified ? 'You marked your safety number as verified' : 'You marked your safety number as unverified';
    case 'signalCall':
      return 'Call';
    case 'deleted':
      return 'This message was deleted';
    case 'viewOnce':
      return 'View-once media';
    default:
      return 'Unsupported message';
  }
}

function buildUserPhoto(avatarPhotoId?: string): UserProfilePhoto {
  return avatarPhotoId ? {
    _: 'userProfilePhoto',
    pFlags: {},
    photo_id: avatarPhotoId,
    dc_id: 0
  } : {_: 'userProfilePhotoEmpty'};
}

function buildChatPhoto(avatarPhotoId?: string): ChatPhoto {
  return avatarPhotoId ? {
    _: 'chatPhoto',
    pFlags: {},
    photo_id: avatarPhotoId,
    dc_id: 0
  } : {_: 'chatPhotoEmpty'};
}
