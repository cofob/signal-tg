import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import { getRandomBytes } from '../crypto';
import { wasm } from '../wasm';

import { GroupAttributeBlobSchema } from '../proto/generated/Groups_pb';

type GroupAttribute = MessageInitShape<typeof GroupAttributeBlobSchema>['content'];

const RANDOMNESS_LENGTH = 32;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Encryption and decryption of group fields with the group's secret params (`GroupSecretParams_DeriveFromMasterKey`),
// as `ClientZkGroupCipher` of `@signalapp/libsignal-client` does. Any member can set fields, such as an invited
// user or a label, to what does not decrypt, so the decrypt functions return `undefined` for such a field and
// callers leave it out like Signal Desktop does (`ts/groups.preload.ts`, `decryptGroupState`).

export function encryptGroupServiceId(secretParams: Uint8Array, serviceId: string) {
  return wasm.GroupSecretParams_EncryptServiceId(secretParams, wasm.ServiceId_ParseFromServiceIdString(serviceId));
}

export function decryptGroupServiceId(secretParams: Uint8Array, ciphertext: Uint8Array) {
  return tryDecrypt(() => (
    wasm.ServiceId_ServiceIdString(wasm.GroupSecretParams_DecryptServiceId(secretParams, ciphertext))
  ));
}

export function decryptGroupProfileKey(secretParams: Uint8Array, ciphertext: Uint8Array, aci: string) {
  if (!ciphertext.length) return undefined;
  return tryDecrypt(() => (
    wasm.GroupSecretParams_DecryptProfileKey(secretParams, ciphertext, wasm.ServiceId_ParseFromServiceIdString(aci))
  ));
}

/** Encrypts a `GroupAttributeBlob`, such as a title or an avatar, without padding as Signal clients do */
export function encryptGroupAttribute(secretParams: Uint8Array, content: GroupAttribute) {
  const blob = create(GroupAttributeBlobSchema, { content });
  return encryptGroupBlob(secretParams, toBinary(GroupAttributeBlobSchema, blob));
}

export function decryptGroupAttribute(secretParams: Uint8Array, blob: Uint8Array) {
  if (!blob.length) return undefined;
  return tryDecrypt(() => fromBinary(GroupAttributeBlobSchema, decryptGroupBlob(secretParams, blob)).content);
}

/** Member labels are encrypted UTF-8 text without a `GroupAttributeBlob` */
export function decryptGroupText(secretParams: Uint8Array, blob: Uint8Array) {
  if (!blob.length) return undefined;
  return tryDecrypt(() => textDecoder.decode(decryptGroupBlob(secretParams, blob)));
}

export function encryptGroupText(secretParams: Uint8Array, text: string) {
  return encryptGroupBlob(secretParams, textEncoder.encode(text));
}

function encryptGroupBlob(secretParams: Uint8Array, plaintext: Uint8Array) {
  return wasm.GroupSecretParams_EncryptBlobWithPaddingDeterministic(
    secretParams, getRandomBytes(RANDOMNESS_LENGTH), plaintext, 0,
  );
}

function tryDecrypt<T>(decrypt: () => T) {
  try {
    return decrypt();
  } catch {
    return undefined;
  }
}

function decryptGroupBlob(secretParams: Uint8Array, blob: Uint8Array) {
  return wasm.GroupSecretParams_DecryptBlobWithPadding(secretParams, blob);
}
