import type ChatConnection from '../chat/ChatConnection';
import type UnauthenticatedChat from '../chat/UnauthenticatedChat';

import { SIGNAL_CDN_HOSTS } from '../config';
import { bufferFromBase64, bufferToBase64 } from '../../../util/encoding/buffer';
import { decryptAesGcmWithNonce } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { wasm } from '../wasm';

export type SignalProfile = {
  identityKey?: Uint8Array;
  givenName?: string;
  familyName?: string;
  about?: string;
  aboutEmoji?: string;
  avatarPath?: string;
  // Whether anyone may send sealed sender messages to this user without their profile key
  hasUnrestrictedUnidentifiedAccess?: boolean;
  // The badges shown on the profile; a profile write sends their ids back, or the server hides them
  visibleBadgeIds: string[];
  // Encrypted fields, base64, that a profile write sends back unchanged
  paymentAddress?: string;
  phoneNumberSharing?: string;
};

type ProfileResponse = {
  identityKey?: string;
  name?: string;
  about?: string;
  aboutEmoji?: string;
  avatar?: string;
  paymentAddress?: string;
  phoneNumberSharing?: string;
  unrestrictedUnidentifiedAccess?: boolean;
  badges?: { id: string; visible?: boolean; expiration?: number }[];
};

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const AVATAR_CDN_NUMBER = 0;

const textDecoder = new TextDecoder();

/** The server has no profile for this profile key version: the user changed their key or has no account any more */
export class ProfileNotFoundError extends Error {
  constructor(readonly aci: string) {
    super(`No profile of ${aci} for this profile key`);
  }
}

/**
 * Fetches the versioned profile of `aci` (`GET /v1/profile/{aci}/{version}`) and decrypts its fields with
 * the profile key (Signal Desktop `ts/services/profiles.preload.ts`). With `unauthenticatedChat`, the request goes
 * without account credentials, as Signal Desktop's `getProfileUnauth`.
 */
export async function fetchProfile(
  connection: ChatConnection, aci: string, profileKey: Uint8Array, unauthenticatedChat?: UnauthenticatedChat,
): Promise<SignalProfile> {
  const serviceId = wasm.ServiceId_ParseFromServiceIdString(aci);
  const version = textDecoder.decode(wasm.ProfileKey_GetProfileKeyVersion(profileKey, serviceId));
  const { status, json } = await sendProfileRequest(
    connection, `/v1/profile/${aci}/${version}`, profileKey, unauthenticatedChat,
  );
  if (status === HTTP_NOT_FOUND) throw new ProfileNotFoundError(aci);
  if (status !== HTTP_OK || !json) throw new Error(`Profile request for ${aci} failed with HTTP ${status}`);

  const key = new Uint8Array(profileKey);
  const name = json.name ? await decryptProfileText(json.name, key) : undefined;
  const [givenName, familyName] = name?.split('\0') ?? [];

  return {
    identityKey: json.identityKey ? bufferFromBase64(json.identityKey) : undefined,
    givenName: givenName || undefined,
    familyName: familyName || undefined,
    about: json.about ? await decryptProfileText(json.about, key) : undefined,
    aboutEmoji: json.aboutEmoji ? await decryptProfileText(json.aboutEmoji, key) : undefined,
    avatarPath: json.avatar,
    hasUnrestrictedUnidentifiedAccess: json.unrestrictedUnidentifiedAccess,
    // Signal Desktop `parseBadgeFromServer` and `encryptProfileData`: only badges with an expiration have a state
    visibleBadgeIds: json.badges
      ?.filter(({ visible, expiration }) => visible === true && typeof expiration === 'number')
      .map(({ id }) => id) ?? [],
    paymentAddress: json.paymentAddress,
    phoneNumberSharing: json.phoneNumberSharing,
  };
}

/**
 * Fetches the identity key from the unversioned profile, which needs no profile key. Returns `undefined` when the
 * user has no account (Signal Desktop falls back to it when the versioned profile is missing).
 */
export async function fetchProfileIdentityKey(
  connection: ChatConnection, aci: string, profileKey: Uint8Array, unauthenticatedChat?: UnauthenticatedChat,
) {
  const { status, json } = await sendProfileRequest(connection, `/v1/profile/${aci}`, profileKey, unauthenticatedChat);
  if (status === HTTP_NOT_FOUND) return undefined;
  if (status !== HTTP_OK || !json) throw new Error(`Profile request for ${aci} failed with HTTP ${status}`);
  return json.identityKey ? bufferFromBase64(json.identityKey) : undefined;
}

/**
 * Sends a profile request with the access key of the profile key on `unauthenticatedChat`. The server answers 401 for
 * an access key it does not accept, and for an unknown user so that the answer does not reveal who exists, and the
 * request then goes on the account's connection.
 */
async function sendProfileRequest(
  connection: ChatConnection, path: string, profileKey: Uint8Array, unauthenticatedChat?: UnauthenticatedChat,
) {
  if (unauthenticatedChat) {
    const response = await unauthenticatedChat.sendJsonRequest<ProfileResponse>('GET', path, undefined, {
      'Unidentified-Access-Key': bufferToBase64(wasm.ProfileKey_DeriveAccessKey(profileKey)),
    });
    if (response.status !== HTTP_UNAUTHORIZED && response.status !== HTTP_FORBIDDEN) return response;
  }
  return connection.sendJsonRequest<ProfileResponse>('GET', path);
}

/** Downloads and decrypts a profile avatar from its CDN path */
export async function downloadProfileAvatar(avatarPath: string, profileKey: Uint8Array) {
  const host = SIGNAL_CDN_HOSTS[AVATAR_CDN_NUMBER];
  const response = await sendHttpRequest(host, {
    trafficClass: 'unauthenticated', method: 'GET', path: `/${avatarPath}`,
  });
  if (response.status !== HTTP_OK) throw new Error(`Avatar download failed with HTTP ${response.status}`);
  return decryptAesGcmWithNonce(new Uint8Array(profileKey), response.body);
}

/** Profile text fields are zero-padded before encryption */
async function decryptProfileText(base64: string, profileKey: Uint8Array<ArrayBuffer>) {
  const padded = await decryptAesGcmWithNonce(profileKey, bufferFromBase64(base64));
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  return textDecoder.decode(padded.subarray(0, end));
}
