import type { ThreadId } from '../types';

import { RE_TG_LINK } from '../config';
import { IS_BAD_URL_PARSER } from './browser/globalEnvironment';
import { parseTimestampDuration } from './dates/timestamp';
import { isBase64Url } from './encoding/base64';
import { toChannelId } from './entities/ids';
import { isUsernameValid } from './entities/username';

export type DeepLinkMethod = 'resolve' | 'login' | 'passport' | 'settings' | 'join' | 'addstickers' | 'addemoji' |
  'setlanguage' | 'addtheme' | 'confirmphone' | 'socks' | 'proxy' | 'privatepost' | 'bg' | 'share' |
  'msg' | 'msg_url' | 'addlist' | 'oauth' |
  'newbot' | 'contact';

interface PublicMessageLink {
  type: 'publicMessageLink';
  username: string;
  messageId: number;
  isSingle: boolean;
  threadId?: ThreadId;
  commentId?: number;
  timestamp?: number;
}

export interface PrivateMessageLink {
  type: 'privateMessageLink';
  channelId: string;
  messageId: number;
  isSingle: boolean;
  threadId?: ThreadId;
  commentId?: number;
  timestamp?: number;
}

interface ShareLink {
  type: 'shareLink';
  url: string;
  text?: string;
}

interface ChatFolderLink {
  type: 'chatFolderLink';
  slug: string;
}

interface LoginCodeLink {
  type: 'loginCodeLink';
  code: string;
}

interface LanguageLink {
  type: 'languageLink';
  langCode: string;
}

interface TelegramPassportLink {
  type: 'telegramPassportLink';
  botId: number;
  scope: string;
  publicKey: string;
  nonce: string;
  callbackUrl?: string;
  payload?: string;
}

interface PublicUsernameOrBotLink {
  type: 'publicUsernameOrBotLink';
  username: string;
  start?: string;
  startGroup?: string;
  ref?: string;
  startApp?: string;
  mode?: string;
  appName?: string;
  startAttach?: string;
  attach?: string;
  text?: string;
  choose?: string;
  isDirect?: boolean;
}

interface GroupCallLink {
  type: 'groupCallLink';
  username: string;
  inviteHash?: string;
}

interface PrivateChannelLink {
  type: 'privateChannelLink';
  channelId: string;
}

interface ContactLink {
  type: 'contactLink';
  token: string;
}

interface SettingsScreenLink {
  type: 'settings';
  path?: string;
}

interface OAuthLink {
  type: 'oauth';
  url: string;
}

interface NewBotLink {
  type: 'newBotLink';
  managerUsername: string;
  username?: string;
  name?: string;
}

type DeepLink =
  LanguageLink |
  TelegramPassportLink |
  LoginCodeLink |
  PublicMessageLink |
  PrivateMessageLink |
  ShareLink |
  ChatFolderLink |
  PublicUsernameOrBotLink |
  GroupCallLink |
  PrivateChannelLink |
  ContactLink |
  SettingsScreenLink |
  OAuthLink |
  NewBotLink;

type BuilderParams<T extends DeepLink> = Record<keyof Omit<T, 'type'>, string | undefined>;
type BuilderReturnType<T extends DeepLink> = T | undefined;
type DeepLinkType = DeepLink['type'] | 'unknown';

type PrivateMessageLinkBuilderParams = Omit<BuilderParams<PrivateMessageLink>, 'isSingle'> & {
  single?: string;
};

type PublicMessageLinkBuilderParams = Omit<BuilderParams<PublicMessageLink>, 'isSingle'> & {
  single?: string;
};

type PublicUsernameOrBotLinkBuilderParams = Omit<BuilderParams<PublicUsernameOrBotLink>, 'isDirect'> & {
  direct?: string;
};

type OAuthLinkBuilderParams = Omit<BuilderParams<OAuthLink>, 'url'> & {
  url: string;
};

const RE_TG_SLASHES_PROTOCOL = /^tg:\/\//i;
const MAX_BOT_START_PARAMETER_LENGTH = 64;

// Only `tg:` links are deep links; links to Telegram websites stay ordinary external links
export function isDeepLink(link: string): boolean {
  return RE_TG_LINK.test(link);
}

export function tryParseDeepLink(link: string): DeepLink | undefined {
  if (!isDeepLink(link)) {
    return undefined;
  }
  try {
    return parseDeepLink(link);
  } catch (err) {
    return undefined;
  }
}

export function getUsernameFromDeepLink(url: string) {
  const deepLink = tryParseDeepLink(url);
  if (deepLink?.type === 'publicUsernameOrBotLink') {
    return deepLink.username;
  }
  return undefined;
}

function parseDeepLink(url: string) {
  const urlToParse = IS_BAD_URL_PARSER ? url.replace(RE_TG_SLASHES_PROTOCOL, 'https://') : url;
  return parseTgLink(new URL(urlToParse));
}

function parseTgLink(url: URL) {
  const { hostname } = url;
  const queryParams = getQueryParams(url);
  const pathParams = getPathParams(url);
  const method = hostname as DeepLinkMethod;

  const deepLinkType = getTgDeepLinkType(queryParams, pathParams, method);
  switch (deepLinkType) {
    case 'languageLink':
      return buildLanguageLink({ langCode: queryParams.lang });
    case 'publicMessageLink': {
      const {
        domain, post, single, thread, comment, t,
      } = queryParams;
      return buildPublicMessageLink({
        username: domain,
        messageId: post,
        single,
        threadId: thread,
        commentId: comment,
        timestamp: t,
      });
    }
    case 'privateMessageLink': {
      const {
        channel, post, single, thread, comment, t,
      } = queryParams;
      return buildPrivateMessageLink({
        channelId: channel,
        messageId: post,
        single,
        threadId: thread,
        commentId: comment,
        timestamp: t,
      });
    }
    case 'shareLink':
      return buildShareLink({ text: queryParams.text, url: queryParams.url });
    case 'chatFolderLink':
      return buildChatFolderLink({ slug: queryParams.slug });
    case 'loginCodeLink':
      return buildLoginCodeLink({ code: queryParams.code });
    case 'telegramPassportLink':
      return buildTelegramPassportLink({
        botId: queryParams.bot_id,
        scope: queryParams.scope,
        publicKey: queryParams.public_key,
        nonce: queryParams.nonce,
        callbackUrl: queryParams.callback_url,
        payload: queryParams.payload,
      });
    case 'publicUsernameOrBotLink':
      return buildPublicUsernameOrBotLink({
        username: queryParams.domain,
        start: queryParams.start,
        startGroup: queryParams.admin !== undefined ? undefined : queryParams.startgroup,
        text: queryParams.text,
        appName: queryParams.appname,
        startApp: queryParams.startapp,
        mode: queryParams.mode,
        startAttach: queryParams.startattach,
        attach: queryParams.attach,
        choose: queryParams.choose,
        ref: queryParams.ref,
        direct: queryParams.direct,
      });
    case 'groupCallLink':
      return buildGroupCallLink({
        username: queryParams.domain,
        inviteHash: getGroupCallInviteHash(queryParams),
      });
    case 'privateChannelLink': {
      return buildPrivateChannelLink({ channelId: queryParams.channel });
    }
    case 'contactLink':
      return buildContactLink({ token: queryParams.token });
    case 'settings':
      return { type: 'settings', path: pathParams.join('/').toLowerCase() || undefined } satisfies SettingsScreenLink;
    case 'oauth':
      return buildOAuthLink({ url: url.toString() });
    case 'newBotLink':
      return buildNewBotLink({
        managerUsername: queryParams.manager,
        username: queryParams.username,
        name: queryParams.name,
      });
    default:
      break;
  }
  return undefined;
}

function getTgDeepLinkType(
  queryParams: Record<string, string>,
  pathParams: string[],
  method: DeepLinkMethod,
): DeepLinkType {
  switch (method) {
    case 'setlanguage':
      return 'languageLink';
    case 'resolve': {
      const {
        domain, post, bot_id, scope, public_key, nonce, startapp,
      } = queryParams;
      if (domain === 'telegrampassport' && bot_id && scope && public_key && nonce) {
        return 'telegramPassportLink';
      }
      if (domain === 'oauth' && startapp) {
        return 'oauth';
      }

      if (domain && isUsernameValid(domain)) {
        if (getGroupCallInviteHash(queryParams) !== undefined) return 'groupCallLink';
        return post ? 'publicMessageLink' : 'publicUsernameOrBotLink';
      }
      break;
    }
    case 'privatepost': {
      const { channel, post } = queryParams;
      if (channel) {
        if (post) return 'privateMessageLink';
        return 'privateChannelLink';
      }
      break;
    }
    case 'msg_url':
      return 'shareLink';
    case 'addlist':
      return 'chatFolderLink';
    case 'login':
      return 'loginCodeLink';
    case 'passport':
      return 'telegramPassportLink';
    case 'contact':
      return 'contactLink';
    case 'settings': {
      return 'settings';
    }
    case 'oauth':
      return 'oauth';
    case 'newbot':
      return 'newBotLink';
    default:
      break;
  }
  return 'unknown';
}

function buildShareLink(params: BuilderParams<ShareLink>): BuilderReturnType<ShareLink> {
  const { url, text } = params;
  if (!url) {
    return undefined;
  }
  return {
    type: 'shareLink',
    url,
    text,
  };
}

function buildPublicMessageLink(params: PublicMessageLinkBuilderParams): BuilderReturnType<PublicMessageLink> {
  const {
    messageId, threadId, commentId, username, single, timestamp,
  } = params;
  if (!username || !isUsernameValid(username)) {
    return undefined;
  }
  if (!messageId || !isNumber(messageId)) {
    return undefined;
  }
  if (threadId && !isNumber(threadId)) {
    return undefined;
  }
  if (commentId && !isNumber(commentId)) {
    return undefined;
  }
  return {
    type: 'publicMessageLink',
    username,
    messageId: Number(messageId),
    isSingle: single === '',
    threadId: threadId ? Number(threadId) : undefined,
    commentId: commentId ? Number(commentId) : undefined,
    timestamp: timestamp ? parseTimestampDuration(timestamp) : undefined,
  };
}

function buildPrivateMessageLink(params: PrivateMessageLinkBuilderParams): BuilderReturnType<PrivateMessageLink> {
  const {
    messageId, threadId, commentId, channelId, single, timestamp,
  } = params;
  if (!channelId || !isNumber(channelId)) {
    return undefined;
  }
  if (!messageId || !isNumber(messageId)) {
    return undefined;
  }
  if (threadId && !isNumber(threadId)) {
    return undefined;
  }
  if (commentId && !isNumber(commentId)) {
    return undefined;
  }
  return {
    type: 'privateMessageLink',
    channelId: toChannelId(channelId),
    messageId: Number(messageId),
    isSingle: single === '',
    threadId: threadId ? Number(threadId) : undefined,
    commentId: commentId ? Number(commentId) : undefined,
    timestamp: timestamp ? parseTimestampDuration(timestamp) : undefined,
  };
}

function buildChatFolderLink(params: BuilderParams<ChatFolderLink>): BuilderReturnType<ChatFolderLink> {
  const {
    slug,
  } = params;
  if (!slug) {
    return undefined;
  }
  return {
    type: 'chatFolderLink',
    slug,
  };
}

function buildLoginCodeLink(params: BuilderParams<LoginCodeLink>): BuilderReturnType<LoginCodeLink> {
  const {
    code,
  } = params;
  if (!code) {
    return undefined;
  }
  return {
    type: 'loginCodeLink',
    code,
  };
}

function buildLanguageLink(params: BuilderParams<LanguageLink>): BuilderReturnType<LanguageLink> {
  const { langCode } = params;
  if (!langCode?.trim()) return undefined;

  return { type: 'languageLink', langCode };
}

function buildTelegramPassportLink(
  params: BuilderParams<TelegramPassportLink>,
): BuilderReturnType<TelegramPassportLink> {
  const {
    botId,
    scope,
    publicKey,
    nonce,
    callbackUrl,
    payload,
  } = params;
  if (!botId || !isNumber(botId) || !scope || !publicKey || !nonce) {
    return undefined;
  }
  return {
    type: 'telegramPassportLink',
    botId: Number(botId),
    scope,
    publicKey,
    nonce,
    callbackUrl,
    payload,
  };
}

function buildPublicUsernameOrBotLink(
  params: PublicUsernameOrBotLinkBuilderParams,
): BuilderReturnType<PublicUsernameOrBotLink> {
  const {
    username,
    start,
    startGroup,
    text,
    startApp,
    mode,
    startAttach,
    attach,
    appName,
    choose,
    ref,
    direct,
  } = params;
  if (!username) {
    return undefined;
  }
  if (!isUsernameValid(username)) {
    return undefined;
  }
  const normalizedStartGroup = normalizeBotStartGroup(startGroup);
  return {
    type: 'publicUsernameOrBotLink',
    username,
    start,
    startGroup: normalizedStartGroup,
    startApp,
    mode,
    appName,
    startAttach,
    attach,
    text,
    choose,
    ref,
    isDirect: direct === '',
  };
}

function normalizeBotStartGroup(startGroup?: string) {
  if (!startGroup || (startGroup.length <= MAX_BOT_START_PARAMETER_LENGTH && isBase64Url(startGroup))) {
    return startGroup;
  }

  return '';
}

function buildGroupCallLink(params: BuilderParams<GroupCallLink>): BuilderReturnType<GroupCallLink> {
  const { username, inviteHash } = params;
  if (!username || !isUsernameValid(username)) {
    return undefined;
  }

  return {
    type: 'groupCallLink',
    username,
    inviteHash: inviteHash || undefined,
  };
}

function buildPrivateChannelLink(params: BuilderParams<PrivateChannelLink>): BuilderReturnType<PrivateChannelLink> {
  const {
    channelId,
  } = params;
  if (!channelId) {
    return undefined;
  }

  return {
    type: 'privateChannelLink',
    channelId: toChannelId(channelId),
  };
}

function buildContactLink(params: BuilderParams<ContactLink>): BuilderReturnType<ContactLink> {
  const { token } = params;

  if (!token) {
    return undefined;
  }

  return {
    type: 'contactLink',
    token,
  };
}

function buildOAuthLink(params: OAuthLinkBuilderParams): BuilderReturnType<OAuthLink> {
  const {
    url,
  } = params;
  return {
    type: 'oauth',
    url,
  };
}

function buildNewBotLink(params: BuilderParams<NewBotLink>): BuilderReturnType<NewBotLink> {
  const {
    managerUsername,
    username,
    name,
  } = params;

  if (!managerUsername || !isUsernameValid(managerUsername)) {
    return undefined;
  }

  return {
    type: 'newBotLink',
    managerUsername,
    username,
    name,
  };
}

function isNumber(s: string) {
  return /^-?\d+$/.test(s);
}

function getGroupCallInviteHash(queryParams: Record<string, string>) {
  return queryParams.livestream ?? queryParams.videochat ?? queryParams.voicechat;
}

function getPathParams(url: URL) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 's') {
    parts.shift();
  }
  return parts.map(decodeURI);
}

function getQueryParams(url: URL) {
  return Object.fromEntries(url.searchParams);
}
