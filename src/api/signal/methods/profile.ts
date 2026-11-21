import type { UsernameErrorReason, UsernameReservation } from '../../../lib/signal/usernames/manageUsername';
import type { ApiPrivacySettings, ApiUser, PrivacyVisibility } from '../../types';

import { setPhoneNumberDiscoverability } from '../../../lib/signal/account/phoneNumberDiscoverability';
import { generateSafetyNumber } from '../../../lib/signal/account/safetyNumber';
import { writeProfile } from '../../../lib/signal/profiles/writeProfile';
import { Verified_State } from '../../../lib/signal/proto/generated/SignalService_pb';
import { lookupUsername, resolveUsernameLink as resolveLink } from '../../../lib/signal/usernames/lookupUsername';
import {
  buildUsernameLinkUrl,
  confirmUsername as confirmReservation,
  deleteUsername as deleteReservedUsername,
  reserveUsername as reserveCandidate,
  setUsernameLink,
  UsernameRequestError,
} from '../../../lib/signal/usernames/manageUsername';
import EMOJI_REGEX from '../../../lib/twemojiRegex';
import { buildApiChat } from '../builders/chats';
import { buildApiUser } from '../builders/users';
import { getCurrentAccount } from '../client';
import {
  client, db, logError, processor, store,
} from '../engine';
import { getConversationByPeerId } from '../peers';

export type UsernameErrorKey = UsernameErrorReason | 'nicknameTooShort' | 'nicknameTooLong' | 'nicknameStartsWithDigit'
  | 'nicknameCharacters' | 'discriminatorInvalid' | 'failed';

// Libsignal username error names (`username_error` in `rust/signal-wasm/src/error.rs`)
const ERROR_KEY_BY_LIBSIGNAL_NAME: Record<string, UsernameErrorKey> = {
  NicknameCannotBeEmpty: 'nicknameTooShort',
  NicknameTooShort: 'nicknameTooShort',
  NicknameTooLong: 'nicknameTooLong',
  CannotStartWithDigit: 'nicknameStartsWithDigit',
  BadNicknameCharacter: 'nicknameCharacters',
  DiscriminatorCannotBeEmpty: 'discriminatorInvalid',
  DiscriminatorCannotBeZero: 'discriminatorInvalid',
  DiscriminatorCannotBeSingleDigit: 'discriminatorInvalid',
  DiscriminatorCannotHaveLeadingZeros: 'discriminatorInvalid',
  BadDiscriminatorCharacter: 'discriminatorInvalid',
  DiscriminatorTooLarge: 'discriminatorInvalid',
};
// Signal Desktop `processImageFile` in `ts/util/processImageFile.dom.ts`: profile avatars are square, at most this big
const AVATAR_MAX_SIZE = 512;
// The about emoji is the emoji that starts the bio, as `buildApiUserFullInfo` shows it
const LEADING_EMOJI_REGEX = new RegExp(`^(${EMOJI_REGEX.source})(?:\\s+|$)`);

// The reservation that `confirmUsername` sets; the server keeps it for five minutes
let usernameReservation: UsernameReservation | undefined;

/**
 * Writes our profile: names, the bio as about text with its leading emoji as the about emoji, and a new or removed
 * avatar. Linked devices may write the profile; only the primary device rotates the profile key.
 */
export async function updateOwnProfile({
  firstName, lastName, bio, photo, shouldRemovePhoto,
}: {
  firstName: string;
  lastName?: string;
  bio?: string;
  photo?: File;
  shouldRemovePhoto?: true;
}) {
  const { about, aboutEmoji } = splitBio(bio?.trim() ?? '');
  try {
    const avatarPath = await writeProfile(client.getSenderContext(), {
      givenName: firstName, familyName: lastName || undefined, about, aboutEmoji,
    }, photo
      ? { type: 'update', avatar: await buildProfileAvatar(photo) }
      : { type: shouldRemovePhoto ? 'clear' : 'unchanged' });
    await processor.updateOwnConversation({
      profileName: firstName, profileFamilyName: lastName || undefined, about, aboutEmoji, avatarPath,
    });
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/**
 * Reserves `nickname.discriminator`, or `nickname` with a free discriminator. Returns the reserved username,
 * which `confirmUsername` then sets, or why it failed.
 */
export async function reserveUsername({ nickname, discriminator }: { nickname: string; discriminator?: string }) {
  const self = await getSelf();
  if (!self) return undefined;

  try {
    usernameReservation = await reserveCandidate(
      client.getSenderContext().connection, nickname, discriminator || undefined, self.username,
    );
    return { username: usernameReservation.username };
  } catch (err) {
    return { error: getUsernameErrorKey(err) };
  }
}

/** Sets the reserved username with a new username link; the storage service account record gets both */
export async function confirmUsername({ username }: { username: string }) {
  if (usernameReservation?.username !== username) return { error: 'reservationExpired' as UsernameErrorKey };

  try {
    const context = client.getSenderContext();
    const result = await confirmReservation(context.connection, usernameReservation, context.account.usernameLink);
    usernameReservation = undefined;
    await processor.updateOwnAccount({ username: result.username, usernameLink: result.link });
    return { username: result.username };
  } catch (err) {
    return { error: getUsernameErrorKey(err) };
  }
}

export async function deleteUsername() {
  try {
    await deleteReservedUsername(client.getSenderContext().connection);
    await processor.updateOwnAccount({ username: undefined, usernameLink: undefined });
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/** The link to our username, `undefined` without a username or link */
export async function fetchUsernameLink() {
  const account = await store.getItem('account');
  const self = await getSelf();
  return self?.username && account?.usernameLink ? buildUsernameLinkUrl(account.usernameLink) : undefined;
}

/** Replaces the username link, so the old link and QR code stop working */
export async function resetUsernameLink() {
  const self = await getSelf();
  if (!self?.username) return undefined;

  try {
    const link = await setUsernameLink(client.getSenderContext().connection, self.username);
    await processor.updateOwnAccount({ usernameLink: link });
    return buildUsernameLinkUrl(link);
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/** Finds a user by username without account credentials; returns the private chat and user */
export async function getChatByUsername(username: string) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return undefined;

  let aci;
  try {
    aci = await lookupUsername(client.getSenderContext().unauthenticatedChat, username);
  } catch (err) {
    logError(err);
    return undefined;
  }
  if (!aci) return undefined;

  const conversation = await processor.getOrCreatePrivateConversation(aci);
  // The lookup proves the username, which the contact's profile does not carry
  const withUsername = conversation.username === username
    ? conversation
    : await processor.setConversationUsername(aci, username);
  return { chat: buildApiChat(withUsername, selfAci), user: buildApiUser(withUsername, selfAci) };
}

/** Without phone number discovery (CDSI), only numbers of known users resolve */
export async function getChatByPhoneNumber(phoneNumber: string) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return undefined;

  const e164 = `+${phoneNumber.replace(/\D/g, '')}`;
  const conversation = (await db.getConversations())
    .find((record) => record.type === 'private' && record.e164 === e164);
  if (!conversation) return undefined;
  return { chat: buildApiChat(conversation, selfAci), user: buildApiUser(conversation, selfAci) };
}

/** The username behind a `signal.me/#eu/` link, `undefined` when the link was reset or is invalid */
export async function resolveUsernameLink(url: string) {
  try {
    return await resolveLink(client.getSenderContext().unauthenticatedChat, url);
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/**
 * The safety number with a contact and whether we verified it. Without their identity key, which a session or
 * their profile brings, there is none yet.
 */
export async function fetchSafetyNumber({ user }: { user: ApiUser }) {
  const account = await store.getItem('account');
  const conversation = await getConversationByPeerId(user.id);
  if (!account || conversation?.type !== 'private') return undefined;

  if (!await store.getIdentity(conversation.id) && client.isConnected) {
    await processor.refreshProfile(conversation.id).catch(logError);
  }
  const safetyNumber = await generateSafetyNumber(store, account.aci, conversation.id);
  if (!safetyNumber) return undefined;

  const identity = await store.getIdentity(conversation.id);
  return {
    digits: safetyNumber.digits,
    // One character per byte, as the QR code encodes it in byte mode
    qrData: String.fromCharCode(...safetyNumber.scannable),
    isVerified: identity?.verified === Verified_State.VERIFIED,
  };
}

export async function updateSafetyNumberVerified({ user, isVerified }: { user: ApiUser; isVerified: boolean }) {
  const conversation = await getConversationByPeerId(user.id);
  if (conversation?.type !== 'private') return undefined;

  try {
    await processor.setVerified(conversation.id, isVerified);
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/**
 * Who sees our number and who can find us by it, as the app's privacy settings `phoneNumber` and `addByPhone`.
 * Signal has only everybody and nobody.
 */
export async function fetchPhoneNumberPrivacy() {
  const account = await store.getItem('account');
  if (!account) return undefined;
  return {
    phoneNumber: buildPrivacySettings(account.isPhoneNumberShared ? 'everybody' : 'nobody'),
    // A primary device registered here knows its choice before the storage service has an account record
    addByPhone: buildPrivacySettings(
      account.isPhoneNumberUnlisted ?? account.isDiscoverableByPhoneNumber === false ? 'nobody' : 'everybody',
    ),
  };
}

/**
 * Changes phone number privacy as Signal Desktop does from a linked device: sharing goes into the encrypted profile,
 * discoverability to the server; both belong in the storage service account record. Sharing the number with
 * everybody makes it discoverable.
 */
export async function updatePhoneNumberPrivacy({ isShared, isDiscoverable }: {
  isShared?: boolean;
  isDiscoverable?: boolean;
}) {
  try {
    const context = client.getSenderContext();
    const shouldBeDiscoverable = isShared ? true : isDiscoverable;
    if (shouldBeDiscoverable !== undefined && shouldBeDiscoverable === Boolean(context.account.isPhoneNumberUnlisted)) {
      await setPhoneNumberDiscoverability(context.connection, shouldBeDiscoverable);
      await processor.updateOwnAccount({ isPhoneNumberUnlisted: !shouldBeDiscoverable });
    }
    if (isShared !== undefined && isShared !== Boolean(context.account.isPhoneNumberShared)) {
      await writeProfile(context, {}, { type: 'unchanged' }, isShared);
      await processor.updateOwnAccount({ isPhoneNumberShared: isShared });
    }
    return fetchPhoneNumberPrivacy();
  } catch (err) {
    logError(err);
    return undefined;
  }
}

async function getSelf() {
  const selfAci = getCurrentAccount()?.aci;
  return selfAci ? db.getConversation(selfAci) : undefined;
}

/** Crops the picture to a centered square, scales it down to `AVATAR_MAX_SIZE` and encodes it as JPEG */
async function buildProfileAvatar(photo: Blob) {
  const bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(side, AVATAR_MAX_SIZE);
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext('2d')!.drawImage(
    bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size,
  );
  bitmap.close();
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg' })).arrayBuffer());
}

function splitBio(bio: string) {
  const match = bio.match(LEADING_EMOJI_REGEX);
  if (!match) return { about: bio || undefined, aboutEmoji: undefined };
  return { about: bio.slice(match[0].length) || undefined, aboutEmoji: match[1] };
}

function getUsernameErrorKey(err: unknown): UsernameErrorKey {
  if (err instanceof UsernameRequestError) return err.reason;
  const libsignalName = (err as { libsignalName?: string }).libsignalName;
  const key = libsignalName ? ERROR_KEY_BY_LIBSIGNAL_NAME[libsignalName] : undefined;
  if (!key) logError(err);
  return key ?? 'failed';
}

function buildPrivacySettings(visibility: PrivacyVisibility): ApiPrivacySettings {
  return {
    visibility,
    allowUserIds: [],
    allowChatIds: [],
    blockUserIds: [],
    blockChatIds: [],
    botsPrivacy: 'none',
  };
}
