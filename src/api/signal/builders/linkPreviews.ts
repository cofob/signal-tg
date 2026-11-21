// Signal Desktop `ts/types/LinkPreview.std.ts`: which link previews of a message are shown

import { RE_LINK_TEMPLATE } from '../../../config';
import convertPunycode from '../../../lib/punycode';

const EXCLUDED_DOMAINS = [
  'debuglogs.org',
  'example',
  'example.com',
  'example.net',
  'example.org',
  'invalid',
  'localhost',
  'onion',
  'test',
];
const DIRECTIONAL_OVERRIDES_REGEX = /[‬‭‮]/;
const UNICODE_DRAWING_REGEX = /[─-◿]/;
const ASCII_REGEX = /[ -\u007F]/;
const ASCII_GLOBAL_REGEX = /[ -\u007F]/g;
const PERIOD_REGEX = /\./g;
// RFC 3986 characters of a path, query and fragment
const VALID_URI_CHARACTERS_REGEX = /^[%:/?#[\]@!$&'()*+,;=A-Za-z0-9\-._~]*$/;
const MAX_HREF_LENGTH = 2 ** 12;
const MAX_HOSTNAME_LENGTH = 2048;
const MIN_DOMAIN_LABELS = 2;
// `https://` and the first character of the host
const PATH_SEARCH_OFFSET = 4;

/**
 * A preview shows only for a safe `https:` link that is one of the links of the message text
 * (`isValidLinkPreview`); stories, which may preview other links, are not supported
 */
export function getIsValidLinkPreview(body: string, url: string) {
  return shouldPreviewHref(url) && findLinks(body).includes(url);
}

function shouldPreviewHref(href: string) {
  const url = parseUrl(href);
  return Boolean(url && url.protocol === 'https:' && !getIsDomainExcluded(url) && getIsLinkSneaky(href) === false);
}

/** Links of a text; one with directional overrides has none (`findLinks` and `shouldLinkifyMessage`) */
function findLinks(text: string) {
  if (DIRECTIONAL_OVERRIDES_REGEX.test(text)) return [];
  return Array.from(text.matchAll(new RegExp(RE_LINK_TEMPLATE, 'gi')), ([link]) => link);
}

function getIsDomainExcluded({ hostname }: URL) {
  return EXCLUDED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/** Long, garbled, credential-carrying or mixed-script links (`isLinkSneaky`) */
function getIsLinkSneaky(href: string): 'yes' | 'maybe' | false {
  if (href.length > MAX_HREF_LENGTH || UNICODE_DRAWING_REGEX.test(href)) return 'yes';

  const url = parseUrl(href);
  if (!url || url.username || url.password || !url.hostname) return 'yes';
  const { hostname } = url;
  if (hostname.length > MAX_HOSTNAME_LENGTH || hostname.includes('%')) return 'yes';
  const labels = hostname.split('.');
  if (labels.length < MIN_DOMAIN_LABELS || labels.some((label) => !label)) return 'yes';

  const withoutPeriods = convertPunycode(hostname).replace(PERIOD_REGEX, '');
  const hasAscii = ASCII_REGEX.test(withoutPeriods);
  const hasNonAscii = withoutPeriods.replace(ASCII_GLOBAL_REGEX, '').length > 0;
  if (hasAscii && hasNonAscii) return 'yes';

  // `url.pathname` would encode the characters this looks for
  const pathStart = href.indexOf('/', url.protocol.length + PATH_SEARCH_OFFSET);
  const pathAndHash = pathStart === -1 ? '' : href.slice(pathStart);
  return VALID_URI_CHARACTERS_REGEX.test(pathAndHash) ? false : 'maybe';
}

function parseUrl(href: string) {
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
}
