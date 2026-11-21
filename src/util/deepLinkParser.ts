import { RE_TG_LINK } from '../config';
import { IS_BAD_URL_PARSER } from './browser/globalEnvironment';
import { isUsernameValid } from './entities/username';

export type DeepLinkMethod = 'resolve' | 'settings' | 'msg_url';

interface ShareLink {
  type: 'shareLink';
  url: string;
  text?: string;
}

interface PublicUsernameLink {
  type: 'publicUsernameLink';
  username: string;
  text?: string;
}

interface SettingsScreenLink {
  type: 'settings';
  path?: string;
}

type DeepLink = ShareLink | PublicUsernameLink | SettingsScreenLink;

type DeepLinkType = DeepLink['type'] | 'unknown';

type BuilderParams<T extends DeepLink> = Record<keyof Omit<T, 'type'>, string | undefined>;
type BuilderReturnType<T extends DeepLink> = T | undefined;

const RE_TG_SLASHES_PROTOCOL = /^tg:\/\//i;

// Deep links are the app's own `tg:` links; Signal's links are handled by `parseSignalLink`
export function isDeepLink(link: string): boolean {
  return RE_TG_LINK.test(link);
}

export function tryParseDeepLink(link: string): DeepLink | undefined {
  if (!RE_TG_LINK.test(link)) {
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

  const deepLinkType = getTgDeepLinkType(queryParams, method);
  switch (deepLinkType) {
    case 'shareLink':
      return buildShareLink({ text: queryParams.text, url: queryParams.url });
    case 'publicUsernameLink':
      return buildPublicUsernameLink({ username: queryParams.domain, text: queryParams.text });
    case 'settings':
      return { type: 'settings', path: pathParams.join('/').toLowerCase() || undefined } satisfies SettingsScreenLink;
    default:
      break;
  }
  return undefined;
}

function getTgDeepLinkType(queryParams: Record<string, string>, method: DeepLinkMethod): DeepLinkType {
  switch (method) {
    case 'resolve':
      return queryParams.domain && isUsernameValid(queryParams.domain) ? 'publicUsernameLink' : 'unknown';
    case 'msg_url':
      return 'shareLink';
    case 'settings':
      return 'settings';
    default:
      return 'unknown';
  }
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

function buildPublicUsernameLink(params: BuilderParams<PublicUsernameLink>): BuilderReturnType<PublicUsernameLink> {
  const { username, text } = params;
  if (!username || !isUsernameValid(username)) {
    return undefined;
  }
  return {
    type: 'publicUsernameLink',
    username,
    text,
  };
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
