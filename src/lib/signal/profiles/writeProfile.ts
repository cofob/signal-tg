import type { SenderContext } from '../sender/sendContent';
import type { SignalProfile } from './fetchProfile';

import { SIGNAL_CDN_HOSTS } from '../config';
import { bufferToBase64 } from '../../../util/encoding/buffer';
import { encodeUtf8, encryptAesGcmWithNonce } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { sendFetchLatestSync } from '../sender/sendMessage';
import { wasm } from '../wasm';
import { fetchProfile } from './fetchProfile';

import { SyncMessage_FetchLatest_Type } from '../proto/generated/SignalService_pb';

type ProfileFields = Pick<SignalProfile, 'givenName' | 'familyName' | 'about' | 'aboutEmoji'>;

export type AvatarChange = { type: 'unchanged' } | { type: 'clear' } | { type: 'update'; avatar: Uint8Array };

/** The form `PUT /v1/profile` returns for uploading a new avatar to the CDN */
type AvatarUploadForm = {
  acl: string;
  algorithm: string;
  credential: string;
  date: string;
  key: string;
  policy: string;
  signature: string;
};

// Signal Desktop `PaddedLengths` in `ts/Crypto.node.ts`: encrypted fields are padded to one of these byte lengths
const NAME_PADDED_LENGTHS = [53, 257];
const ABOUT_PADDED_LENGTHS = [128, 254, 512];
const ABOUT_EMOJI_PADDED_LENGTHS = [32];
const AVATAR_CDN_NUMBER = 0;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const textDecoder = new TextDecoder();

/**
 * Writes our profile: encrypts the fields with our profile key, sends them with `PUT /v1/profile` under the
 * version and commitment of that key, uploads a new avatar to the form the server returns, and asks our other
 * devices to fetch the profile (Signal Desktop `ts/services/writeProfile.preload.ts`). `fields` are merged over
 * the current profile on the server, so a field that is present replaces it, even as `undefined`, and the others
 * keep their values. The payment address, the visible badges and, unless `isPhoneNumberShared` is given, phone
 * number sharing keep their current values as well. The write fails without a given name. Returns the CDN path of
 * the avatar.
 */
export async function writeProfile(
  context: SenderContext,
  fields: ProfileFields,
  avatarChange: AvatarChange,
  isPhoneNumberShared?: boolean,
) {
  const { account, connection } = context;
  const profileKey = new Uint8Array(account.profileKey!);
  const serviceId = wasm.ServiceId_ParseFromServiceIdString(account.aci);
  const current = await fetchProfile(connection, account.aci, profileKey);

  const {
    givenName, familyName, about, aboutEmoji,
  } = { ...current, ...fields };
  // Signal Desktop asserts this: without a given name, the family name would take its place
  if (!givenName?.trim()) throw new Error('Cannot set an empty profile name');

  const name = familyName ? `${givenName}\0${familyName}` : givenName;
  const phoneNumberSharing = isPhoneNumberShared !== undefined
    ? bufferToBase64(await encryptAesGcmWithNonce(profileKey, new Uint8Array([isPhoneNumberShared ? 1 : 0])))
    : current.phoneNumberSharing;
  const request = {
    version: textDecoder.decode(wasm.ProfileKey_GetProfileKeyVersion(profileKey, serviceId)),
    commitment: bufferToBase64(wasm.ProfileKey_GetCommitment(profileKey, serviceId)),
    name: await encryptProfileText(name, profileKey, NAME_PADDED_LENGTHS),
    about: about ? await encryptProfileText(about, profileKey, ABOUT_PADDED_LENGTHS) : undefined,
    aboutEmoji: aboutEmoji ? await encryptProfileText(aboutEmoji, profileKey, ABOUT_EMOJI_PADDED_LENGTHS) : undefined,
    badgeIds: current.visibleBadgeIds,
    paymentAddress: current.paymentAddress,
    phoneNumberSharing,
    avatar: avatarChange.type !== 'clear',
    sameAvatar: avatarChange.type === 'unchanged',
  };

  const { status, json } = await connection.sendJsonRequest<AvatarUploadForm>('PUT', '/v1/profile', request);
  if (status !== HTTP_OK) throw new Error(`Profile write failed with HTTP ${status}`);

  let avatarPath = avatarChange.type === 'unchanged' ? current.avatarPath : undefined;
  if (avatarChange.type === 'update') {
    if (!json?.key) throw new Error('Profile write returned no avatar upload form');
    const encrypted = await encryptAesGcmWithNonce(profileKey, new Uint8Array(avatarChange.avatar));
    await uploadAvatar(json, encrypted);
    avatarPath = json.key;
  }

  await sendFetchLatestSync(context, SyncMessage_FetchLatest_Type.LOCAL_PROFILE);
  return avatarPath;
}

/** Profile text is zero-padded to the shortest allowed length that fits, so its length shows less */
async function encryptProfileText(text: string, profileKey: Uint8Array<ArrayBuffer>, paddedLengths: number[]) {
  const bytes = encodeUtf8(text);
  const paddedLength = paddedLengths.find((length) => bytes.length <= length);
  if (!paddedLength) throw new Error('Profile field is too long');
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  return bufferToBase64(await encryptAesGcmWithNonce(profileKey, padded));
}

/** Posts the encrypted avatar to CDN 0 as an S3 form upload (Signal Desktop `uploadAvatar` and `makePutParams`) */
async function uploadAvatar(form: AvatarUploadForm, encrypted: Uint8Array) {
  const boundary = `----------------${crypto.randomUUID().replace(/-/g, '')}`;
  const fields: [string, string][] = [
    ['key', form.key],
    ['x-amz-credential', form.credential],
    ['acl', form.acl],
    ['x-amz-algorithm', form.algorithm],
    ['x-amz-date', form.date],
    ['policy', form.policy],
    ['x-amz-signature', form.signature],
    ['Content-Type', 'application/octet-stream'],
  ];
  const start = [
    ...fields.map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`),
    `--${boundary}\r\nContent-Disposition: form-data; name="file"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  ].join('\r\n');
  const startBytes = encodeUtf8(start);
  const endBytes = encodeUtf8(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(startBytes.length + encrypted.length + endBytes.length);
  body.set(startBytes);
  body.set(encrypted, startBytes.length);
  body.set(endBytes, startBytes.length + encrypted.length);

  const { status } = await sendHttpRequest(SIGNAL_CDN_HOSTS[AVATAR_CDN_NUMBER], {
    trafficClass: 'authenticated',
    method: 'POST',
    path: '/',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  if (status !== HTTP_OK && status !== HTTP_NO_CONTENT) throw new Error(`Avatar upload failed with HTTP ${status}`);
}
