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
      case 'languageLink':
        actions.openLanguageModal({ langCode: parsedLink.langCode });
        return true;
      case 'privateMessageLink':
        actions.openPrivateChannel({
          id: parsedLink.channelId,
          threadId: parsedLink.threadId,
          messageId: parsedLink.messageId,
          commentId: parsedLink.commentId,
          timestamp: parsedLink.timestamp,
          linkContext,
        });
        return true;
      case 'publicMessageLink': {
        actions.openChatByUsername({
          username: parsedLink.username,
          threadId: parsedLink.threadId,
          messageId: parsedLink.messageId,
          commentId: parsedLink.commentId,
          timestamp: parsedLink.timestamp,
          linkContext,
        });
        return true;
      }
      case 'publicUsernameOrBotLink':
        actions.openChatByUsername({
          username: parsedLink.username,
          text: parsedLink.text,
          isDirect: parsedLink.isDirect,
        });
        return true;
      case 'contactLink':
        actions.openChatByContactToken({
          token: parsedLink.token,
        });
        return true;
      case 'privateChannelLink': {
        actions.openPrivateChannel({
          id: parsedLink.channelId,
        });
        return true;
      }
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

  const {
    checkChatInvite,
    openChatByUsername,
    openPhoneNumberLookupModal,
    openStickerSet,
    openChatWithDraft,
    openStoryViewerByUsername,
  } = actions;

  switch (method) {
    case 'resolve': {
      const {
        domain, phone, post, comment, thread, topic, story,
      } = params;

      const threadId = Number(thread) || Number(topic) || undefined;

      if (phone) {
        // The lookup tells the contact discovery service about the number, so the user confirms it first
        const phoneNumber = phone.replace(RE_NON_DIGIT, '');
        if (RE_E164_DIGITS.test(phoneNumber)) {
          openPhoneNumberLookupModal({ phoneNumber });
        } else {
          getActions().showNotification({ message: { key: 'SignalLinkInvalid' } });
        }
      } else if (story) {
        openStoryViewerByUsername({ username: domain, storyId: Number(story) });
      } else {
        openChatByUsername({
          username: domain,
          messageId: post ? Number(post) : undefined,
          commentId: comment ? Number(comment) : undefined,
          threadId,
        });
      }
      break;
    }
    case 'bg': {
      // const {
      //   slug, color, rotation, mode, intensity, bg_color: bgColor, gradient,
      // } = params;
      break;
    }
    case 'join': {
      const { invite } = params;

      checkChatInvite({ hash: invite });
      break;
    }
    case 'addemoji':
    case 'addstickers': {
      const { set } = params;

      openStickerSet({
        stickerSetInfo: {
          shortName: set,
        },
      });
      break;
    }
    case 'share':
    case 'msg':
    case 'msg_url': {
      const { url: urlParam, text } = params;
      openChatWithDraft({ text: formatShareText(urlParam, text) });
      break;
    }
    case 'login': {
      // const { code, token } = params;
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
    case 'callLink':
    case 'linkDevice':
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
