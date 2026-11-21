import { getActions } from '../global';

import type { ApiFormattedText, LinkContext,
} from '../api/types';
import type { DeepLinkMethod } from './deepLinkParser';
import { LeftColumnContent } from '../types';

import { RE_TG_LINK,
} from '../config';
import { IS_BAD_URL_PARSER } from './browser/globalEnvironment';
import { tryParseDeepLink } from './deepLinkParser';

export const processDeepLink = (url: string, linkContext?: LinkContext): boolean => {
  const actions = getActions();

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
      case 'groupCallLink':
        actions.joinVoiceChatByLink({
          username: parsedLink.username,
          inviteHash: parsedLink.inviteHash,
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
    openChatByPhoneNumber,
    openStickerSet,
    openChatWithDraft,
    checkChatlistInvite,
    openStoryViewerByUsername,
  } = actions;

  switch (method) {
    case 'resolve': {
      const {
        domain, phone, post, comment, thread, topic, story, text,
      } = params;

      const threadId = Number(thread) || Number(topic) || undefined;

      if (phone) {
        openChatByPhoneNumber({
          phoneNumber: phone,
          text,
        });
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
    case 'addstyle': {
      const { set } = params;
      if (!set) return false;
      actions.openAiTonePreview({ slug: set });
      break;
    }
    case 'share':
    case 'msg':
    case 'msg_url': {
      const { url: urlParam, text } = params;
      openChatWithDraft({ text: formatShareText(urlParam, text) });
      break;
    }
    case 'addlist': {
      checkChatlistInvite({ slug: params.slug });
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

export function formatShareText(url?: string, text?: string, title?: string): ApiFormattedText {
  return {
    text: [url, title, text].filter(Boolean).join('\n'),
  };
}
