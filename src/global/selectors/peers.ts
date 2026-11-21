import type { ApiPeer } from '../../api/types';
import type { GlobalState } from '../types';

import { getHasAdminRight, isChatChannel } from '../helpers';
import { selectChat, selectChatFullInfo } from './chats';
import { selectPeerProfileColor } from './ui';
import { selectUser, selectUserFullInfo } from './users';

export function selectPeer<T extends GlobalState>(global: T, peerId: string): ApiPeer | undefined {
  return selectUser(global, peerId) || selectChat(global, peerId);
}

export function selectPeerPhotos<T extends GlobalState>(global: T, peerId: string) {
  return global.peers.profilePhotosById[peerId];
}

export function selectPeerAvatarPhoto<T extends GlobalState>(global: T, peerId: string) {
  const avatarPhotoId = selectPeer(global, peerId)?.avatarPhotoId;
  if (!avatarPhotoId) return undefined;

  const userFullInfo = selectUserFullInfo(global, peerId);
  const profilePhoto = userFullInfo ? userFullInfo.profilePhoto : selectChatFullInfo(global, peerId)?.profilePhoto;
  if (profilePhoto?.id === avatarPhotoId) return profilePhoto;
  if (userFullInfo?.personalPhoto?.id === avatarPhotoId) return userFullInfo.personalPhoto;
  if (userFullInfo?.fallbackPhoto?.id === avatarPhotoId) return userFullInfo.fallbackPhoto;

  const galleryPhoto = selectPeerPhotos(global, peerId)?.photos[0];
  return galleryPhoto?.id === avatarPhotoId ? galleryPhoto : undefined;
}

export function selectPeerHasProfileBackground<T extends GlobalState>(global: T, peerId: string) {
  const peer = selectPeer(global, peerId);
  if (!peer) return false;
  const profileColor = selectPeerProfileColor(global, peer);

  return Boolean(profileColor);
}

export function selectCanUpdateMainTab<T extends GlobalState>(global: T, peerId: string) {
  if (global.currentUserId === peerId) {
    return true;
  }

  const chat = selectChat(global, peerId);
  return Boolean(chat && isChatChannel(chat) && getHasAdminRight(chat, 'postMessages'));
}

// Slow, not to be used in `withGlobal`
export function selectPeerByUsername<T extends GlobalState>(global: T, username: string): ApiPeer | undefined {
  const usernameLowered = username.toLowerCase();
  return Object.values(global.users.byId).find(
    (user) => user.usernames?.some((c) => c.username.toLowerCase() === usernameLowered),
  ) || Object.values(global.chats.byId).find(
    (chat) => chat.usernames?.some((c) => c.username.toLowerCase() === usernameLowered),
  );
}
