import type UnauthenticatedChat from '../chat/UnauthenticatedChat';

import { base64UrlToBuffer, bufferToBase64Url } from '../../../util/encoding/base64';
import { uuidToString } from '../serviceId';
import { wasm } from '../wasm';

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const LINK_ENTROPY_LENGTH = 32;
const LINK_UUID_LENGTH = 16;
// `https://signal.me/#eu/<base64url of 32 bytes of entropy and a 16-byte UUID>`
const USERNAME_LINK_PATTERN = /^(?:https|sgnl):\/\/signal\.me\/?#eu\/([A-Za-z0-9_-]+)$/;

/**
 * Finds the ACI of a username such as `alice.42`, or returns `undefined` when nobody has it.
 * The server sees only the username hash, and the request carries no account credentials.
 */
export async function lookupUsername(unauthenticatedChat: UnauthenticatedChat, username: string) {
  const hash = bufferToBase64Url(wasm.Username_Hash(username));
  const { status, json } = await unauthenticatedChat.sendJsonRequest<{ uuid: string }>(
    'GET', `/v1/accounts/username_hash/${hash}`,
  );
  if (status === HTTP_NOT_FOUND) return undefined;
  if (status !== HTTP_OK || !json) throw new Error(`Username lookup failed with HTTP ${status}`);
  return json.uuid;
}

/** Returns the username behind a username link or QR code, or `undefined` when the link was reset */
export async function resolveUsernameLink(unauthenticatedChat: UnauthenticatedChat, url: string) {
  const match = url.match(USERNAME_LINK_PATTERN);
  const bytes = match ? base64UrlToBuffer(match[1]) : undefined;
  if (!bytes || bytes.length !== LINK_ENTROPY_LENGTH + LINK_UUID_LENGTH) throw new Error('Invalid username link');

  const entropy = bytes.subarray(0, LINK_ENTROPY_LENGTH);
  const linkId = uuidToString(bytes.subarray(LINK_ENTROPY_LENGTH));
  const { status, json } = await unauthenticatedChat.sendJsonRequest<{ usernameLinkEncryptedValue: string }>(
    'GET', `/v1/accounts/username_link/${linkId}`,
  );
  if (status === HTTP_NOT_FOUND) return undefined;
  if (status !== HTTP_OK || !json) throw new Error(`Username link lookup failed with HTTP ${status}`);
  return wasm.UsernameLink_DecryptUsername(entropy, base64UrlToBuffer(json.usernameLinkEncryptedValue));
}
