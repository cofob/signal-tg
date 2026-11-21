import { getActions } from '../global';

import type { ApiFormattedText, LinkContext } from '../api/types';
import type { DeepLinkMethod } from './deepLinkParser';
import type { SignalLink } from './signalLinks';
import { LeftColumnContent } from '../types';

import { RE_TG_LINK } from '../config';
import { IS_BAD_URL_PARSER } from './browser/globalEnvironment';
import { tryParseDeepLink } from './deepLinkParser';
import { parseSignalLink } from './signalLinks';

const RE_NON_DIGIT = /\D/g;
// E.164 numbers have 7 to 15 digits and no leading zero, as in `signal.me/#p/` links (`signalLinks.ts`)
const RE_E164_DIGITS = /^[1-9]\d{6,14}$/;

/**
 * Opens a link inside the app: a Signal link (`signal.me`, `signal.group`, `signal.art`, `signal.link`, `signal.tube`
 * or `sgnl:`) or one of the app's own `tg:` links. Returns `false` for any other link.
 */
export const processDeepLink = (url: string, linkContext?: LinkContext): boolean => {
  const actions = getActions();

  const signalLink = parseSignalLink(url);
  if (signalLink) {
    openSignalLink(signalLink);
    return true;
  }

  const parsedLink = tryParseDeepLink(url);
  if (parsedLink) {
    switch (parsedLink.type) {
      case 'publicUsernameLink':
        actions.openChatByUsername({
          username: parsedLink.username,
          text: parsedLink.text,
        });
        return true;
      case 'settings': {
        if (parsedLink.path) {
          actions.openSettingsLink({ path: parsedLink.path });
        } else {
          actions.openLeftColumnContent({ contentKey: LeftColumnContent.Settings });
        }
        return true;
      }
      default:
        break;
    }
  }

  if (!url.match(RE_TG_LINK)) {
    return false;
  }

  const urlToParse = IS_BAD_URL_PARSER ? url.replace(/^tg:\/\//, 'https://') : url;

  const {
    protocol, searchParams, hostname,
  } = new URL(urlToParse);

  if (protocol !== 'tg:') return false;

  const method = hostname as DeepLinkMethod;
  const params = Object.fromEntries(searchParams);

  const { openPhoneNumberLookupModal, openChatWithDraft } = actions;

  switch (method) {
    case 'resolve': {
      const { phone } = params;

      if (!phone) return false;

      // The lookup tells the contact discovery service about the number, so the user confirms it first
      const phoneNumber = phone.replace(RE_NON_DIGIT, '');
      if (RE_E164_DIGITS.test(phoneNumber)) {
        openPhoneNumberLookupModal({ phoneNumber });
      } else {
        actions.showNotification({ message: { key: 'SignalLinkInvalid' } });
      }
      break;
    }
    case 'msg_url': {
      const { url: urlParam, text } = params;
      openChatWithDraft({ text: formatShareText(urlParam, text) });
      break;
    }
    default:
      // Unsupported deeplink
      return false;
  }
  return true;
};

/**
 * Opens what a Signal link points to. A username opens its chat. Anything with a consequence waits for the user: a
 * group and a sticker pack show their preview first, a phone number asks before it goes to the contact discovery
 * service, and the links to what this app cannot do open a dialog that explains it.
 */
export function openSignalLink(link: SignalLink, tabId?: number) {
  const actions = getActions();

  switch (link.type) {
    case 'usernameLink':
      actions.openChatByUsernameLink({ url: link.url, tabId });
      break;
    case 'phoneNumber':
      // A link can come from anyone, and looking its number up tells the contact discovery service about it
      actions.openPhoneNumberLookupModal({ phoneNumber: link.phoneNumber, tabId });
      break;
    case 'groupInvite':
      actions.checkChatInvite({ hash: link.url, tabId });
      break;
    case 'stickerPack':
      actions.openStickerSet({ stickerSetInfo: { id: link.packId, accessHash: link.packKey }, tabId });
      break;
    case 'proxy':
      actions.openSignalLinkModal({ type: 'proxy', host: link.host, tabId });
      break;
    case 'linkDevice':
      actions.openSignalLinkDevice({ url: link.url, tabId });
      break;
    case 'callLink':
    case 'reRegister':
      actions.openSignalLinkModal({ type: link.type, tabId });
      break;
    case 'invalid':
      actions.showNotification({ message: { key: 'SignalLinkInvalid' }, tabId });
      break;
  }
}

export function formatShareText(url?: string, text?: string, title?: string): ApiFormattedText {
  return {
    text: [url, title, text].filter(Boolean).join('\n'),
  };
}
