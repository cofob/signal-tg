import type ChatConnection from '../chat/ChatConnection';

import { base64UrlToBuffer, bufferToBase64Url } from '../../../util/encoding/base64';
import { buffersEqual } from '../../../util/encoding/buffer';
import { getRandomBytes } from '../crypto';
import { uuidToBytes } from '../serviceId';
import { wasm } from '../wasm';

export type UsernameReservation = {
  username: string;
  hash: Uint8Array;
  // The username the reservation replaces; a reservation that only changes its case keeps the link handle
  previousUsername?: string;
};

/** What a username link encodes: the key that decrypts the username and the server's id of the link */
export type UsernameLink = {
  entropy: Uint8Array;
  serverId: string;
};

export type UsernameErrorReason = 'taken' | 'reservationExpired' | 'notSet' | 'rateLimited' | 'invalid';

export class UsernameRequestError extends Error {
  constructor(readonly reason: UsernameErrorReason, status?: number) {
    super(`Username request failed: ${reason}${status ? ` (HTTP ${status})` : ''}`);
  }
}

// Signal Desktop `getMinNickname` and `getMaxNickname` in `ts/util/Username.std.ts` (remote config defaults)
export const MIN_NICKNAME_LENGTH = 3;
export const MAX_NICKNAME_LENGTH = 32;
const USERNAME_LINK_ENTROPY_LENGTH = 32;
const PROOF_RANDOMNESS_LENGTH = 32;
const USERNAME_LINK_BASE_URL = 'https://signal.me/#eu/';
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * Reserves a username for five minutes (`PUT /v1/accounts/username_hash/reserve`): `nickname.discriminator` when
 * the discriminator is given, else the first free one of generated candidates. A case change of the current
 * nickname keeps its discriminator and needs no reservation (Signal Desktop `reserveUsername` in
 * `ts/services/username.preload.ts`). Invalid nicknames and discriminators throw libsignal's username errors.
 */
export async function reserveUsername(
  connection: ChatConnection, nickname: string, discriminator?: string, previousUsername?: string,
): Promise<UsernameReservation> {
  if (previousUsername && !discriminator) {
    const [previousNickname, previousDiscriminator] = splitUsername(previousUsername);
    if (nickname.toLowerCase() === previousNickname.toLowerCase()) {
      const username = `${nickname}.${previousDiscriminator}`;
      return { username, hash: wasm.Username_Hash(username), previousUsername };
    }
  }

  const candidates = discriminator
    ? [validateUsernameParts(nickname, discriminator)]
    : wasm.Username_CandidatesFrom(nickname, MIN_NICKNAME_LENGTH, MAX_NICKNAME_LENGTH);
  const hashes = candidates.map((candidate) => wasm.Username_Hash(candidate));

  const { status, json } = await connection.sendJsonRequest<{ usernameHash: string }>(
    'PUT', '/v1/accounts/username_hash/reserve', { usernameHashes: hashes.map(bufferToBase64Url) },
  );
  if (status !== HTTP_OK || !json) throw buildError(status);

  const reservedHash = base64UrlToBuffer(json.usernameHash);
  const index = hashes.findIndex((hash) => buffersEqual(hash, reservedHash));
  if (index === -1) throw new UsernameRequestError('invalid');
  return { username: candidates[index], hash: hashes[index], previousUsername };
}

/**
 * Sets the reserved username with a proof that we know it, and a new username link for it
 * (`PUT /v1/accounts/username_hash/confirm`). A case change keeps the link handle and only replaces
 * the encrypted username behind `previousLink`.
 */
export async function confirmUsername(
  connection: ChatConnection, reservation: UsernameReservation, previousLink?: UsernameLink,
) {
  const { username, hash, previousUsername } = reservation;
  const isCaseChange = previousUsername !== undefined
    && previousUsername !== username && previousUsername.toLowerCase() === username.toLowerCase();
  if (isCaseChange && previousLink) {
    return { username, link: await setUsernameLink(connection, username, previousLink.entropy) };
  }

  const { entropy, encryptedUsername } = createUsernameLink(username);
  const { status, json } = await connection.sendJsonRequest<{ usernameLinkHandle: string }>(
    'PUT', '/v1/accounts/username_hash/confirm', {
      usernameHash: bufferToBase64Url(hash),
      zkProof: bufferToBase64Url(wasm.Username_Proof(username, getRandomBytes(PROOF_RANDOMNESS_LENGTH))),
      encryptedUsername: bufferToBase64Url(encryptedUsername),
    },
  );
  if (status !== HTTP_OK || !json) throw buildError(status, 'reservationExpired');
  return { username, link: { entropy, serverId: json.usernameLinkHandle } };
}

/** Removes our username and its link (`DELETE /v1/accounts/username_hash`) */
export async function deleteUsername(connection: ChatConnection) {
  const { status } = await connection.sendJsonRequest('DELETE', '/v1/accounts/username_hash');
  if (status !== HTTP_OK && status !== HTTP_NO_CONTENT) throw buildError(status);
}

/**
 * Replaces the username link (`PUT /v1/accounts/username_link`). Without `entropy` the link gets a new key and
 * a new server id, so the old link and QR code stop working; with it, the link stays and encrypts `username`.
 */
export async function setUsernameLink(
  connection: ChatConnection, username: string, entropy?: Uint8Array,
): Promise<UsernameLink> {
  const link = createUsernameLink(username, entropy);
  const { status, json } = await connection.sendJsonRequest<{ usernameLinkHandle: string }>(
    'PUT', '/v1/accounts/username_link', {
      usernameLinkEncryptedValue: bufferToBase64Url(link.encryptedUsername),
      keepLinkHandle: Boolean(entropy),
    },
  );
  if (status !== HTTP_OK || !json) throw buildError(status, 'notSet');
  return { entropy: link.entropy, serverId: json.usernameLinkHandle };
}

/** Removes the username link and keeps the username (`DELETE /v1/accounts/username_link`) */
export async function deleteUsernameLink(connection: ChatConnection) {
  const { status } = await connection.sendJsonRequest('DELETE', '/v1/accounts/username_link');
  if (status !== HTTP_OK && status !== HTTP_NO_CONTENT) throw buildError(status);
}

/** The `signal.me` link that `resolveUsernameLink` reads */
export function buildUsernameLinkUrl({ entropy, serverId }: UsernameLink) {
  const bytes = new Uint8Array(USERNAME_LINK_ENTROPY_LENGTH + uuidToBytes(serverId).length);
  bytes.set(entropy);
  bytes.set(uuidToBytes(serverId), USERNAME_LINK_ENTROPY_LENGTH);
  return `${USERNAME_LINK_BASE_URL}${bufferToBase64Url(bytes)}`;
}

/** Splits `nickname.discriminator` at the last dot */
export function splitUsername(username: string): [string, string] {
  const separator = username.lastIndexOf('.');
  return [username.slice(0, separator), username.slice(separator + 1)];
}

function validateUsernameParts(nickname: string, discriminator: string) {
  wasm.Username_HashFromParts(nickname, discriminator, MIN_NICKNAME_LENGTH, MAX_NICKNAME_LENGTH);
  return `${nickname}.${discriminator}`;
}

function createUsernameLink(username: string, entropy?: Uint8Array) {
  const bytes = wasm.UsernameLink_Create(username, entropy);
  return {
    entropy: bytes.slice(0, USERNAME_LINK_ENTROPY_LENGTH),
    encryptedUsername: bytes.slice(USERNAME_LINK_ENTROPY_LENGTH),
  };
}

/** 409 means no candidate was free for a reservation, an expired reservation, or no username for a link */
function buildError(status: number, conflictReason: UsernameErrorReason = 'taken') {
  switch (status) {
    case HTTP_CONFLICT:
      return new UsernameRequestError(conflictReason, status);
    case HTTP_GONE:
      return new UsernameRequestError('taken', status);
    case HTTP_UNPROCESSABLE:
      return new UsernameRequestError('invalid', status);
    case HTTP_TOO_MANY_REQUESTS:
      return new UsernameRequestError('rateLimited', status);
    default:
      return new Error(`Username request failed with HTTP ${status}`);
  }
}
