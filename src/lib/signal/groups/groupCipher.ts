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
// as `ClientZkGroupCipher` of `@signalapp/libsignal-client` does

export function encryptGroupServiceId(secretParams: Uint8Array, serviceId: string) {
  return wasm.GroupSecretParams_EncryptServiceId(secretParams, wasm.ServiceId_ParseFromServiceIdString(serviceId));
}

export function decryptGroupServiceId(secretParams: Uint8Array, ciphertext: Uint8Array) {
  return wasm.ServiceId_ServiceIdString(wasm.GroupSecretParams_DecryptServiceId(secretParams, ciphertext));
}

export function decryptGroupProfileKey(secretParams: Uint8Array, ciphertext: Uint8Array, aci: string) {
  return ciphertext.length
    ? wasm.GroupSecretParams_DecryptProfileKey(secretParams, ciphertext, wasm.ServiceId_ParseFromServiceIdString(aci))
    : undefined;
}

/** Encrypts a `GroupAttributeBlob`, such as a title or an avatar, without padding as Signal clients do */
export function encryptGroupAttribute(secretParams: Uint8Array, content: GroupAttribute) {
  const blob = create(GroupAttributeBlobSchema, { content });
  return encryptGroupBlob(secretParams, toBinary(GroupAttributeBlobSchema, blob));
}

export function decryptGroupAttribute(secretParams: Uint8Array, blob: Uint8Array) {
  return blob.length ? fromBinary(GroupAttributeBlobSchema, decryptGroupBlob(secretParams, blob)).content : undefined;
}

/** Member labels are encrypted UTF-8 text without a `GroupAttributeBlob` */
export function decryptGroupText(secretParams: Uint8Array, blob: Uint8Array) {
  return blob.length ? textDecoder.decode(decryptGroupBlob(secretParams, blob)) : undefined;
}

export function encryptGroupText(secretParams: Uint8Array, text: string) {
  return encryptGroupBlob(secretParams, textEncoder.encode(text));
}

function encryptGroupBlob(secretParams: Uint8Array, plaintext: Uint8Array) {
  return wasm.GroupSecretParams_EncryptBlobWithPaddingDeterministic(
    secretParams, getRandomBytes(RANDOMNESS_LENGTH), plaintext, 0,
  );
}

function decryptGroupBlob(secretParams: Uint8Array, blob: Uint8Array) {
  return wasm.GroupSecretParams_DecryptBlobWithPadding(secretParams, blob);
}
