import type { Credentials } from '../net/rest';

import { SIGNAL_CHAT_HOST } from '../config';
import { bufferToBase64 } from '../../../util/encoding/buffer';
import { encodeUtf8, encryptAesGcmWithNonce } from '../crypto';
import { sendJsonRequest } from '../net/rest';
import { wasm } from '../wasm';

// Profile names are zero-padded to the first length that fits (Signal Desktop `PaddedLengths.Name`)
const NAME_PADDED_LENGTHS = [53, 257];
// Phone number sharing with everybody is off, as for new Signal Android accounts
const PHONE_NUMBER_SHARING_DISABLED = new Uint8Array([0]);

const textDecoder = new TextDecoder();

/**
 * Uploads our versioned profile with the name encrypted by the profile key and no avatar (`PUT /v1/profile`,
 * Signal Desktop `ts/util/encryptProfileData.preload.ts` and `WebAPI.putProfile`)
 */
export async function uploadProfile(credentials: Credentials, {
  aci, profileKey, givenName, familyName,
}: {
  aci: string;
  profileKey: Uint8Array;
  givenName: string;
  familyName?: string;
}) {
  const serviceId = wasm.ServiceId_ParseFromServiceIdString(aci);
  const key = new Uint8Array(profileKey);
  const name = [givenName, familyName].filter(Boolean).join('\0');

  await sendJsonRequest(SIGNAL_CHAT_HOST, {
    method: 'PUT',
    path: '/v1/profile',
    credentials,
    json: {
      version: textDecoder.decode(wasm.ProfileKey_GetProfileKeyVersion(profileKey, serviceId)),
      name: bufferToBase64(await encryptPadded(encodeUtf8(name), key, NAME_PADDED_LENGTHS)),
      avatar: false,
      sameAvatar: false,
      commitment: bufferToBase64(wasm.ProfileKey_GetCommitment(profileKey, serviceId)),
      phoneNumberSharing: bufferToBase64(await encryptAesGcmWithNonce(key, PHONE_NUMBER_SHARING_DISABLED)),
      badgeIds: [],
    },
  });
}

function encryptPadded(value: Uint8Array, key: Uint8Array<ArrayBuffer>, paddedLengths: number[]) {
  const paddedLength = paddedLengths.find((length) => value.length <= length);
  if (!paddedLength) throw new Error('Profile value is too long');
  const padded = new Uint8Array(paddedLength);
  padded.set(value);
  return encryptAesGcmWithNonce(key, padded);
}
