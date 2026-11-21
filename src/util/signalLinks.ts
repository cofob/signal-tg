import { getIsStickerPackValid } from '../lib/signal/stickers/stickerPackLinks';

/**
 * A Signal link as the apps share it. `invalid` is a link that belongs to Signal's own routes or to the `sgnl:` scheme
 * but that no route accepts, such as a sticker pack link without a valid key or an `sgnl:` host that Signal Desktop
 * uses only between its own windows.
 */
export type SignalLink = {
  type: 'usernameLink';
  /** `https://signal.me/#eu/<encrypted username>`, the form `resolveUsernameLink` reads */
  url: string;
  /** base64url of 32 bytes of entropy and the 16-byte id of the link */
  encryptedUsername: string;
} | {
  type: 'phoneNumber';
  /** The digits of the number, without `+` */
  phoneNumber: string;
} | {
  type: 'groupInvite';
  /** `https://signal.group/#<code>`, the form `parseGroupInviteLink` reads */
  url: string;
  inviteCode: string;
} | {
  type: 'stickerPack';
  /** Lowercase hex */
  packId: string;
  /** Lowercase hex */
  packKey: string;
} | {
  type: 'proxy';
  /** Lowercase host name of the Signal proxy */
  host: string;
} | {
  type: 'callLink';
  key: string;
} | {
  type: 'linkDevice';
  /** The whole link, which a primary device sends the new device's key from */
  url: string;
} | {
  type: 'reRegister';
} | {
  type: 'invalid';
};

type LinkParts = {
  scheme: 'https' | 'sgnl';
  host: string;
  path: string;
  query: string;
  fragment: string;
};

// Routes of Signal Desktop `ts/util/signalRoutes.std.ts` and Signal Android `AndroidManifest.xml`, with the proxy links
// of `SignalProxyUtil`. A host is exact ASCII: ports, user names, trailing dots and look-alike letters, including the
// ones that lowercase to ASCII such as the Kelvin sign, never match.
const SIGNAL_ME_HOST = 'signal.me';
const SIGNAL_GROUP_HOST = 'signal.group';
const SIGNAL_ART_HOST = 'signal.art';
const SIGNAL_LINK_HOST = 'signal.link';
const SIGNAL_TUBE_HOST = 'signal.tube';
// Hosts of `sgnl://` links that have no website
const JOIN_GROUP_HOST = 'joingroup';
const ADD_STICKERS_HOST = 'addstickers';
const LINK_DEVICE_HOST = 'linkdevice';
const REREG_HOST = 'rereg';

const ADD_STICKERS_PATH = '/addstickers';
const CALL_PATH = '/call';
const USERNAME_PREFIX = 'eu/';
const PHONE_PREFIX = 'p/';

const MAX_LINK_LENGTH = 4096;
const MAX_INVITE_CODE_LENGTH = 256;

// `scheme://host/path?query#fragment`, any part but the host optional; a link without a scheme is an `https:` link
const LINK_PATTERN = /^(?:([a-z][a-z\d+.-]*):\/\/)?([^/?#\s]+)(\/[^?#\s]*)?(?:\?([^#\s]*))?(?:#(\S*))?$/i;
// 32 bytes of entropy and the 16-byte link id in base64url
const USERNAME_CODE_PATTERN = /^[A-Za-z0-9_-]{64}$/;
// E.164 digits; `%2B` is an encoded `+`
const PHONE_PATTERN = /^(?:\+|%2B)([1-9]\d{6,14})$/i;
// `GroupInviteLink` in base64url, with or without padding
const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;
const CALL_KEY_ALPHABET = '[bcdfghkmnpqrstxz]';
// Consonant base 16 (`ringrtc` `ConsonantBase16`) in groups of 4 letters, or of 8, 8, 8, 8, 2 and 8 with the epoch
const CALL_KEY_GROUPS = [[4, 4, 4, 4, 4, 4, 4, 4], [8, 8, 8, 8, 2, 8]];
const CALL_KEY_PATTERN = new RegExp(`^(?:${CALL_KEY_GROUPS.map(buildGroupsPattern).join('|')})$`);
// A DNS name with at least two labels, and an optional port that Signal's clients ignore
const PROXY_PATTERN = /^((?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?::\d{1,5})?$/i;
const MAX_HOST_LENGTH = 253;

const SGNL_PREFIX_PATTERN = /^sgnl:/i;
const NON_ASCII_PATTERN = /[\u0080-\uffff]/;
const SGNL_SCHEME_PREFIX = 'sgnl://';

const INVALID_LINK = { type: 'invalid' } as const;

/**
 * Turns a `signal.me`, `signal.group`, `signal.art`, `signal.link` or `signal.tube` link, or an `sgnl:` link, into
 * its route. Returns `undefined` for anything else, including the pages of those sites that are no routes, which
 * stay ordinary web links. Pure: it neither fetches the link nor decodes keys.
 */
export function parseSignalLink(text: string): SignalLink | undefined {
  const link = text.trim();
  if (!link || link.length > MAX_LINK_LENGTH) return undefined;

  const parts = splitLink(link);
  const route = parts && parseRoute(parts);
  // The `sgnl:` scheme is the apps' own: a link in it that is no route is an error, not a website
  return route || (isSgnlLink(link) ? INVALID_LINK : undefined);
}

/** Whether a link is in the `sgnl:` scheme, which only Signal's apps handle */
export function isSgnlLink(text: string) {
  return SGNL_PREFIX_PATTERN.test(text.trim());
}

/** Whether a text is a Signal link that the app can open, and not an `invalid` one */
export function isSignalRoute(text: string) {
  const link = parseSignalLink(text);
  return Boolean(link && link.type !== 'invalid');
}

/**
 * Where the link that the text has at `offset` starts. The pattern that finds links in a text leaves out the `sgnl://`
 * before a Signal link, so the start moves back over it when it makes `link` a Signal link.
 */
export function getSgnlLinkStart(text: string, offset: number, link: string) {
  const start = offset - SGNL_SCHEME_PREFIX.length;
  if (start < 0 || text.slice(start, offset).toLowerCase() !== SGNL_SCHEME_PREFIX) return offset;
  return isSignalRoute(`${SGNL_SCHEME_PREFIX}${link}`) ? start : offset;
}

/** The link of a sticker pack, as `signal.art` shares it */
export function buildStickerPackLink(packId: string, packKey: string) {
  return `https://${SIGNAL_ART_HOST}${ADD_STICKERS_PATH}/#pack_id=${packId}&pack_key=${packKey}`;
}

function buildGroupsPattern(lengths: number[]) {
  return lengths.map((length) => `${CALL_KEY_ALPHABET}{${length}}`).join('-');
}

function splitLink(link: string): LinkParts | undefined {
  const match = link.match(LINK_PATTERN);
  if (!match) return undefined;

  const [, rawScheme, host, path = '', query = '', fragment = ''] = match;
  // `toLowerCase` maps some non-ASCII letters, such as the Kelvin sign, to ASCII ones
  if (NON_ASCII_PATTERN.test(host)) return undefined;

  const scheme = rawScheme?.toLowerCase() ?? 'https';
  if (scheme !== 'https' && scheme !== 'sgnl') return undefined;

  return { scheme, host: host.toLowerCase(), path, query, fragment };
}

function parseRoute(parts: LinkParts) {
  const { scheme, host } = parts;
  const isSgnl = scheme === 'sgnl';

  switch (host) {
    case SIGNAL_ME_HOST:
      return parseSignalMe(parts);
    case SIGNAL_GROUP_HOST:
      return parseGroupInvite(parts);
    case JOIN_GROUP_HOST:
      return isSgnl ? parseGroupInvite(parts) : undefined;
    case SIGNAL_ART_HOST:
      return parseArtStickers(parts);
    case ADD_STICKERS_HOST:
      return isSgnl ? parseSgnlStickers(parts) : undefined;
    case SIGNAL_LINK_HOST:
      return parseCallLink(parts);
    case SIGNAL_TUBE_HOST:
      return parseProxy(parts);
    case LINK_DEVICE_HOST:
      return isSgnl ? parseLinkDevice(parts) : undefined;
    case REREG_HOST:
      return isSgnl && isRootPath(parts) ? { type: 'reRegister' } as const : undefined;
    default:
      return undefined;
  }
}

function parseSignalMe(parts: LinkParts): SignalLink | undefined {
  const { fragment } = parts;
  if (!isRootPath(parts) || parts.query) return undefined;

  if (fragment.startsWith(USERNAME_PREFIX)) {
    const encryptedUsername = fragment.slice(USERNAME_PREFIX.length);
    return USERNAME_CODE_PATTERN.test(encryptedUsername)
      ? { type: 'usernameLink', url: `https://${SIGNAL_ME_HOST}/#eu/${encryptedUsername}`, encryptedUsername }
      : INVALID_LINK;
  }

  if (fragment.startsWith(PHONE_PREFIX)) {
    const phoneNumber = fragment.slice(PHONE_PREFIX.length).match(PHONE_PATTERN)?.[1];
    return phoneNumber ? { type: 'phoneNumber', phoneNumber } : INVALID_LINK;
  }

  return undefined;
}

function parseGroupInvite(parts: LinkParts): SignalLink | undefined {
  const { fragment: inviteCode } = parts;
  // A segment: the fragment of a group link has no slash
  if (!isRootPath(parts) || parts.query || !inviteCode || inviteCode.includes('/')) return undefined;

  if (inviteCode.length > MAX_INVITE_CODE_LENGTH || !INVITE_CODE_PATTERN.test(inviteCode)) return INVALID_LINK;
  return { type: 'groupInvite', url: `https://${SIGNAL_GROUP_HOST}/#${inviteCode}`, inviteCode };
}

function parseArtStickers(parts: LinkParts): SignalLink | undefined {
  if (parts.scheme !== 'https' || !isPath(parts, ADD_STICKERS_PATH) || parts.query || !parts.fragment) return undefined;
  return buildStickerPack(parts.fragment);
}

function parseSgnlStickers(parts: LinkParts): SignalLink | undefined {
  if (!isRootPath(parts) || parts.fragment || !parts.query) return undefined;
  return buildStickerPack(parts.query);
}

function buildStickerPack(params: string): SignalLink {
  const searchParams = new URLSearchParams(params);
  const packId = searchParams.get('pack_id')?.toLowerCase();
  const packKey = searchParams.get('pack_key')?.toLowerCase();
  if (!packId || !packKey || !getIsStickerPackValid(packId, packKey)) return INVALID_LINK;
  return { type: 'stickerPack', packId, packKey };
}

function parseCallLink(parts: LinkParts): SignalLink | undefined {
  // Links made before 2023 have no slash after `call`
  if (!isPath(parts, CALL_PATH) || parts.query || !parts.fragment) return undefined;

  const key = new URLSearchParams(parts.fragment).get('key');
  return key && CALL_KEY_PATTERN.test(key) ? { type: 'callLink', key } : INVALID_LINK;
}

function parseProxy(parts: LinkParts): SignalLink | undefined {
  const { fragment } = parts;
  if (!isRootPath(parts) || parts.query || !fragment) return undefined;

  const host = fragment.match(PROXY_PATTERN)?.[1].toLowerCase();
  return host && host.length <= MAX_HOST_LENGTH ? { type: 'proxy', host } : INVALID_LINK;
}

function parseLinkDevice(parts: LinkParts): SignalLink | undefined {
  if (!isRootPath(parts) || parts.fragment || !parts.query) return undefined;

  const params = new URLSearchParams(parts.query);
  return params.get('uuid') && params.get('pub_key')
    ? { type: 'linkDevice', url: `sgnl://${LINK_DEVICE_HOST}?${parts.query}` }
    : INVALID_LINK;
}

function isRootPath({ path }: LinkParts) {
  return !path || path === '/';
}

function isPath({ path }: LinkParts, expectedPath: string) {
  return path === expectedPath || path === `${expectedPath}/`;
}
