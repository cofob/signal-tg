import { PUSH_IDB_STORE } from './browser/idb';
import { bufferToBase64Url } from './encoding/base64';

export const PUSH_STATE_KEY = 'state';
export const PUSH_DISPLAY_LOCK = 'tt-push-display';
export const PUSH_REGISTRATION_LOCK = 'tt-push-registration';
export const PUSH_KEY_LENGTH = 256;
export const PUSH_KEY_ID_LENGTH = 8;
export const PUSH_CLICK_PREFIX = 'click_';
export const PUSH_CLICK_TIMEOUT_MS = 2 * 60 * 1000;

export type PushAccount = {
  slot: number;
  // Hidden previews use the random key fingerprint to prevent guessing the account's user ID
  userHash: string;
  keyId?: string;
  isTest?: boolean;
  shouldHidePreviews: boolean;
  shouldShowPreviewsWhenLocked: boolean;
};

export type PushState = {
  accounts: Record<number, PushAccount>;
  hiddenMessage: string;
  hasPasscode?: boolean;
  revision: string;
};

export type PushTarget = {
  chatId?: string;
  messageId?: number;
  threadId?: number;
  storyId?: number;
  isStoryReaction?: boolean;
  kind?: 'message' | 'reaction' | 'story';
};

export type PushNotification = PushTarget & {
  slot: number;
  userHash: string;
  title: string;
  body: string;
  isSilent?: boolean;
  shouldUseSystemSound?: boolean;
  icon?: string;
  shouldReplaceHistory?: boolean;
  isGeneric?: boolean;
  id?: string;
  clientId?: string;
  clickedAt?: number;
  revision?: string;
  lockEpoch?: number;
};

export function readPushState() {
  return PUSH_IDB_STORE.get<PushState>(PUSH_STATE_KEY);
}

export async function hashPushValue(value: string) {
  return bufferToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

export async function getPushKeyId(key: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', key));
  return bufferToBase64Url(hash.slice(-PUSH_KEY_ID_LENGTH));
}
