import type { ConversationRecord } from '../../../lib/signal/db/MessageDb';
import type { ApiUser } from '../../types';

import { getPeerId } from '../peers';

const HASH_MULTIPLIER = 31;

/** Builds the user of a private conversation; `selfAci` marks our own user (Note to Self) */
export function buildApiUser(conversation: ConversationRecord, selfAci: string): ApiUser {
  const [firstName, lastName] = getUserNames(conversation);
  return {
    id: getPeerId(conversation),
    isMin: false,
    isSelf: conversation.id === selfAci ? true : undefined,
    isContact: conversation.systemName ? true : undefined,
    type: 'userTypeRegular',
    firstName,
    lastName,
    phoneNumber: conversation.e164?.replace(/^\+/, '') ?? '',
    usernames: conversation.username ? [{ username: conversation.username, isActive: true }] : undefined,
    hasUsername: Boolean(conversation.username),
    avatarPhotoId: getAvatarPhotoId(conversation),
  };
}

/**
 * The avatar id of a user or group: a hash of its CDN path, so it changes with the avatar.
 * `downloadMedia` resolves `avatar<peerId>?<avatarPhotoId>` through the conversation's `avatarPath`.
 */
export function getAvatarPhotoId(conversation: ConversationRecord) {
  const { avatarPath } = conversation;
  if (!avatarPath) return undefined;
  let hash = 0;
  for (let i = 0; i < avatarPath.length; i++) {
    hash = Math.imul(hash, HASH_MULTIPLIER) + avatarPath.charCodeAt(i) | 0;
  }
  return String(hash >>> 0);
}

/** Names in Signal's priority: nickname, then the name from the phone's contacts, then the profile name */
function getUserNames(conversation: ConversationRecord): [string | undefined, string | undefined] {
  const name = conversation.nickname ?? conversation.systemName;
  if (name) return [name, undefined];
  if (conversation.profileName) return [conversation.profileName, conversation.profileFamilyName];
  return [conversation.e164 ?? conversation.username, undefined];
}
