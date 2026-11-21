import type { ThreadId } from '../types';

import { RE_TG_LINK } from '../config';
import { IS_BAD_URL_PARSER } from './browser/globalEnvironment';
import { parseTimestampDuration } from './dates/timestamp';
import { toChannelId } from './entities/ids';
import { isUsernameValid } from './entities/username';

export type DeepLinkMethod = 'resolve' | 'login' | 'settings' | 'join' | 'addstickers' | 'addemoji' |
  'setlanguage' | 'addtheme' | 'addstyle' | 'confirmphone' | 'socks' | 'proxy' | 'privatepost' | 'bg' | 'share' |
  'msg' | 'msg_url' | 'contact';

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

interface LoginCodeLink {
  type: 'loginCodeLink';
  code: string;
}

interface LanguageLink {
  type: 'languageLink';
  langCode: string;
}

interface PublicUsernameOrBotLink {
  type: 'publicUsernameOrBotLink';
  username: string;
  text?: string;
  isDirect?: boolean;
  noPaidMessagesToken?: string;
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
  noPaidMessagesToken?: string;
}

interface SettingsScreenLink {
  type: 'settings';
  path?: string;
}

type DeepLink =
  LanguageLink |
  LoginCodeLink |
  PublicMessageLink |
  PrivateMessageLink |
  ShareLink |
  PublicUsernameOrBotLink |
  GroupCallLink |
  PrivateChannelLink |
  ContactLink |
  SettingsScreenLink;

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

const RE_TG_SLASHES_PROTOCOL = /^tg:\/\//i;

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
    case 'loginCodeLink':
      return buildLoginCodeLink({ code: queryParams.code });
    case 'publicUsernameOrBotLink':
      return buildPublicUsernameOrBotLink({
        username: queryParams.domain,
        text: queryParams.text,
        direct: queryParams.direct,
        noPaidMessagesToken: queryParams.free,
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
      return buildContactLink({ token: queryParams.token, noPaidMessagesToken: queryParams.free });
    case 'settings':
      return { type: 'settings', path: pathParams.join('/').toLowerCase() || undefined } satisfies SettingsScreenLink;
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
      const { domain, post } = queryParams;
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
    case 'login':
      return 'loginCodeLink';
    case 'contact':
      return 'contactLink';
    case 'settings': {
      return 'settings';
    }
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

function buildPublicUsernameOrBotLink(
  params: PublicUsernameOrBotLinkBuilderParams,
): BuilderReturnType<PublicUsernameOrBotLink> {
  const {
    username,
    text,
    direct,
    noPaidMessagesToken,
  } = params;
  if (!username) {
    return undefined;
  }
  if (!isUsernameValid(username)) {
    return undefined;
  }
  return {
    type: 'publicUsernameOrBotLink',
    username,
    text,
    isDirect: direct === '',
    noPaidMessagesToken: noPaidMessagesToken || undefined,
  };
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
  const { token, noPaidMessagesToken } = params;

  if (!token) {
    return undefined;
  }

  return {
    type: 'contactLink',
    token,
    noPaidMessagesToken: noPaidMessagesToken || undefined,
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
