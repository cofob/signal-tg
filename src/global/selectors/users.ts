import type {
  ApiUser, ApiUserCommonChats,
  ApiUserFullInfo, ApiUserSavedMusic, ApiUserStatus,
} from '../../api/types';
import type { GlobalState } from '../types';

export function selectUser<T extends GlobalState>(global: T, userId: string): ApiUser | undefined {
  return global.users.byId[userId];
}

export function selectUserStatus<T extends GlobalState>(global: T, userId: string): ApiUserStatus | undefined {
  return global.users.statusesById[userId];
}

export function selectUserFullInfo<T extends GlobalState>(global: T, userId: string): ApiUserFullInfo | undefined {
  return global.users.fullInfoById[userId];
}

export function selectUserCommonChats<T extends GlobalState>(
  global: T, userId: string,
): ApiUserCommonChats | undefined {
  return global.users.commonChatsById[userId];
}

export function selectUserSavedMusic<T extends GlobalState>(
  global: T, userId: string,
): ApiUserSavedMusic | undefined {
  return global.users.savedMusicByPeerId[userId];
}

export function selectIsUserBlocked<T extends GlobalState>(global: T, userId: string) {
  return selectUserFullInfo(global, userId)?.isBlocked;
}

export function selectIsUserChatProtected<T extends GlobalState>(global: T, userId: string) {
  const fullInfo = selectUserFullInfo(global, userId);
  if (!fullInfo) return undefined;

  return Boolean(fullInfo.noForwardsMyEnabled || fullInfo.noForwardsPeerEnabled);
}

export function selectCurrentUserId<T extends GlobalState>(global: T) {
  return global.currentUserId;
}

export function selectIsCurrentUserFrozen<T extends GlobalState>(global: T) {
  return Boolean(global.appConfig.freezeUntilDate);
}

/**
 * Slow, not to be used in `withGlobal`
 */
export function selectUserByPhoneNumber<T extends GlobalState>(global: T, phoneNumber: string) {
  const phoneNumberCleaned = phoneNumber.replace(/[^0-9]/g, '');

  return Object.values(global.users.byId).find((user) => user?.phoneNumber === phoneNumberCleaned);
}
