import type ChatConnection from '../chat/ChatConnection';

import { SIGNAL_CDN_HOSTS } from '../config';
import { bufferFromBase64 } from '../../../util/encoding/buffer';
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
const AVATAR_CDN_NUMBER = 0;

const textDecoder = new TextDecoder();

/**
 * Fetches the versioned profile of `aci` (`GET /v1/profile/{aci}/{version}`) and decrypts its fields with
 * the profile key (Signal Desktop `ts/services/profiles.preload.ts`).
 */
export async function fetchProfile(
  connection: ChatConnection, aci: string, profileKey: Uint8Array,
): Promise<SignalProfile> {
  const serviceId = wasm.ServiceId_ParseFromServiceIdString(aci);
  const version = textDecoder.decode(wasm.ProfileKey_GetProfileKeyVersion(profileKey, serviceId));
  const { status, json } = await connection.sendJsonRequest<ProfileResponse>('GET', `/v1/profile/${aci}/${version}`);
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

/** Downloads and decrypts a profile avatar from its CDN path */
export async function downloadProfileAvatar(avatarPath: string, profileKey: Uint8Array) {
  const host = SIGNAL_CDN_HOSTS[AVATAR_CDN_NUMBER];
  const response = await sendHttpRequest(host, { method: 'GET', path: `/${avatarPath}` });
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
