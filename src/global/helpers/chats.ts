import type {
  ApiChat,
  ApiChatAdminRights,
  ApiChatBannedRights,
  ApiChatFolder,
  ApiChatInviteInfo,
  ApiPeer,
} from '../../api/types';
import type {
  CustomPeer,
} from '../../types';
import type { RegularLangKey } from '../../types/language';
import type { LangFn } from '../../util/localization';

import {
  ARCHIVED_FOLDER_ID, USERNAME_LINK_PREFIX,
} from '../../config';
import { getPeerIdDividend, isUserId } from '../../util/entities/ids';
import { formatDateTime, secondsToDate } from '../../util/localization/dateFormat';
import { selectIsChatRestricted } from '../selectors';
import { getGlobal } from '..';
import { getMainUsername } from './users';

type AdminPermissionContainer = {
  adminRights?: ApiChatAdminRights;
  isOwner?: boolean;
};

const FOREVER_BANNED_DATE = Date.now() / 1000 + 31622400; // 366 days

export function isChatGroup(chat: ApiChat) {
  return isChatBasicGroup(chat);
}

export function isChatBasicGroup(chat: ApiChat) {
  return chat.type === 'chatTypeBasicGroup';
}

export function isCommonBoxChat(chat: ApiChat) {
  return chat.type === 'chatTypePrivate' || chat.type === 'chatTypeBasicGroup';
}

export function getChatTypeLangKey(chat: ApiChat): RegularLangKey {
  switch (chat.type) {
    case 'chatTypePrivate':
      return 'ChatTypePrivate';
    case 'chatTypeBasicGroup':
      return 'ChatTypeGroup';
    default:
      return 'ChatTypeFallback';
  }
}

export function getChatTitle(lang: LangFn, chat: ApiChat, isSelf = false) {
  if (isSelf) {
    return lang('NoteToSelf');
  }
  return chat.title || lang('HiddenName');
}

export function getChatLink(chat: ApiChat) {
  const activeUsername = getMainUsername(chat);

  return activeUsername ? `${USERNAME_LINK_PREFIX}${activeUsername}` : undefined;
}

export function getChatAvatarHash(
  owner: ApiPeer,
  size: 'normal' | 'big' = 'normal',
  avatarPhotoId = owner.avatarPhotoId,
) {
  if (!avatarPhotoId) {
    return undefined;
  }

  switch (size) {
    case 'big':
      return `profile${owner.id}?${avatarPhotoId}`;
    default:
      return `avatar${owner.id}?${avatarPhotoId}`;
  }
}

export function isChatAdmin(chat: ApiChat) {
  return Boolean(chat.adminRights || chat.isOwner);
}

export function getHasAdminRight(
  permissionContainer: AdminPermissionContainer,
  key: keyof ApiChatAdminRights,
) {
  return Boolean(permissionContainer.adminRights?.[key]
    || (permissionContainer.isOwner && key !== 'anonymous'));
}

export function isUserRightBanned(chat: ApiChat, key: keyof ApiChatBannedRights) {
  return Boolean(chat.currentUserBannedRights?.[key] || chat.defaultBannedRights?.[key]);
}

export function getCanPostInChat(chat: ApiChat) {
  const global = getGlobal();
  const isRestricted = selectIsChatRestricted(global, chat.id);
  if (isRestricted || chat.isForbidden || chat.isNotJoined) {
    return false;
  }

  if (isUserId(chat.id)) {
    return true;
  }

  return isChatAdmin(chat) || !isUserRightBanned(chat, 'sendMessages');
}

export interface IAllowedAttachmentOptions {
  canAttachMedia: boolean;
  canAttachPolls: boolean;
  canSendStickers: boolean;
  canSendGifs: boolean;
  canAttachEmbedLinks: boolean;
  canSendPhotos: boolean;
  canSendVideos: boolean;
  canSendRoundVideos: boolean;
  canSendAudios: boolean;
  canSendVoices: boolean;
  canSendPlainText: boolean;
  canSendDocuments: boolean;
}

export function getAllowedAttachmentOptions(
  chat?: ApiChat,
  isSavedMessages = false,
  isStoryReply = false,
  isEphemeral = false,
): IAllowedAttachmentOptions {
  if (!chat) {
    return {
      canAttachMedia: false,
      canAttachPolls: false,
      canSendStickers: false,
      canSendGifs: false,
      canAttachEmbedLinks: false,
      canSendPhotos: false,
      canSendVideos: false,
      canSendRoundVideos: false,
      canSendAudios: false,
      canSendVoices: false,
      canSendPlainText: false,
      canSendDocuments: false,
    };
  }

  const isAdmin = isChatAdmin(chat);

  return {
    canAttachMedia: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendMedia'),
    canAttachPolls: !isEphemeral && !isStoryReply
      && (isAdmin || !isUserRightBanned(chat, 'sendPolls'))
      && (!isUserId(chat.id) || isSavedMessages),
    canSendStickers: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendStickers'),
    canSendGifs: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendGifs'),
    canAttachEmbedLinks: !isStoryReply && (isAdmin || !isUserRightBanned(chat, 'embedLinks')),
    canSendPhotos: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendPhotos'),
    canSendVideos: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendVideos'),
    canSendRoundVideos: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendRoundvideos'),
    canSendAudios: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendAudios'),
    canSendVoices: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendVoices'),
    canSendPlainText: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendPlain'),
    canSendDocuments: isAdmin || isStoryReply || !isUserRightBanned(chat, 'sendDocs'),
  };
}

export function getMessageSendingRestrictionReason(
  lang: LangFn,
  currentUserBannedRights?: ApiChatBannedRights,
  defaultBannedRights?: ApiChatBannedRights,
) {
  if (currentUserBannedRights?.sendMessages) {
    const { untilDate } = currentUserBannedRights;
    return untilDate && untilDate < FOREVER_BANNED_DATE
      ? lang(
        'ChannelPermissionDeniedSendMessagesUntil',
        { date: formatDateTime(lang, secondsToDate(untilDate), { date: 'short', time: 'short' }) },
      )
      : lang('ChannelPersmissionDeniedSendMessagesForever');
  }

  if (defaultBannedRights?.sendMessages) {
    return lang('ChannelPersmissionDeniedSendMessagesDefaultRestrictedText');
  }

  return undefined;
}

export function isChatArchived(chat: ApiChat) {
  return chat.folderId === ARCHIVED_FOLDER_ID;
}

export function getCanDeleteChat(chat: ApiChat) {
  return isChatBasicGroup(chat);
}

export function getFolderDescriptionText(lang: LangFn, folder: ApiChatFolder, chatsCount?: number) {
  const {
    excludedChatIds, includedChatIds,
    groups, contacts, nonContacts,
  } = folder;

  const filters = [groups, contacts, nonContacts];

  // If folder has multiple additive filters or uses include/exclude lists,
  // we display folder chats count
  if (
    chatsCount !== undefined && (
      Object.values(filters).filter(Boolean).length > 1
      || (excludedChatIds?.length)
      || (includedChatIds?.length)
    )) {
    return lang('ChatsPlural', { count: chatsCount }, { pluralValue: chatsCount });
  }

  // Otherwise, we return a short description of a single filter
  if (groups) {
    return lang('FilterGroups');
  } else if (contacts) {
    return lang('FilterContacts');
  } else if (nonContacts) {
    return lang('FilterNonContacts');
  } else {
    return undefined;
  }
}

export function getPeerColorKey(peer: ApiPeer | CustomPeer | undefined, isForAvatar?: boolean) {
  if (!peer) return 0;

  if ('isCustomPeer' in peer) {
    return peer.peerColorId;
  }

  if (peer.color) {
    if (peer.color.type === 'regular' && peer.color.color !== undefined) return peer.color.color;
  }

  return getPeerIdDividend(peer.id) % 7;
}

export function getPeerColorCount(peer: ApiPeer) {
  const key = getPeerColorKey(peer);
  if (key === undefined) return 1;

  const global = getGlobal();
  return global.peerColors?.general[key].colors?.length || 1;
}

export function getGroupStatus(lang: LangFn, chat: ApiChat) {
  const chatTypeKey = getChatTypeLangKey(chat);
  const { membersCount } = chat;

  const global = getGlobal();
  const isRestricted = selectIsChatRestricted(global, chat.id);
  if (isRestricted) {
    return lang('GroupInaccessible');
  }

  if (!membersCount) {
    return lang(chatTypeKey);
  }

  return lang('NMembers', { count: membersCount }, { pluralValue: membersCount });
}

export function getCustomPeerFromInvite(invite: ApiChatInviteInfo): CustomPeer {
  const {
    title, color, isVerified, isFake, isScam,
  } = invite;
  return {
    isCustomPeer: true,
    title,
    peerColorId: color,
    isVerified,
    fakeType: isFake ? 'fake' : isScam ? 'scam' : undefined,
  };
}
