import { getActions } from '../global';

import type {
  ApiChatType, ApiFormattedText, LinkContext,
} from '../api/types';
import type { DeepLinkMethod } from './deepLinkParser';
import { LeftColumnContent } from '../types';

import {
  API_CHAT_TYPES, RE_TG_LINK,
} from '../config';
import { IS_BAD_URL_PARSER } from './browser/globalEnvironment';
import { tryParseDeepLink } from './deepLinkParser';
import { parseSignalMeLink } from './signalLinks';

export const processDeepLink = (url: string, linkContext?: LinkContext): boolean => {
  const actions = getActions();

  const signalMeLink = parseSignalMeLink(url);
  if (signalMeLink?.type === 'usernameLink') {
    actions.openChatByUsernameLink({ url: signalMeLink.url });
    return true;
  }
  if (signalMeLink?.type === 'phoneNumber') {
    actions.openChatByPhoneNumber({ phoneNumber: signalMeLink.phoneNumber });
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
      case 'publicUsernameOrBotLink': {
        const choose = parseChooseParameter(parsedLink.choose);

        actions.openChatByUsername({
          username: parsedLink.username,
          startParam: parsedLink.start,
          startGroup: parsedLink.startGroup,
          ref: parsedLink.ref,
          text: parsedLink.text,
          startApp: parsedLink.startApp,
          mode: parsedLink.mode,
          startAttach: parsedLink.startAttach,
          attach: parsedLink.attach,
          choose,
          originalParts: [parsedLink.username, parsedLink.appName],
          isDirect: parsedLink.isDirect,
          noPaidMessagesToken: parsedLink.noPaidMessagesToken,
        });
        return true;
      }
      case 'groupCallLink':
        actions.joinVoiceChatByLink({
          username: parsedLink.username,
          inviteHash: parsedLink.inviteHash,
        });
        return true;
      case 'contactLink':
        actions.openChatByContactToken({
          token: parsedLink.token,
          noPaidMessagesToken: parsedLink.noPaidMessagesToken,
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
      case 'oauth':
        if (linkContext?.type !== 'inner') return false;
        actions.requestLinkUrlAuth({ url: parsedLink.url });
        return true;
      case 'newBotLink':
        actions.openBotCreationModal({
          managerUsername: parsedLink.managerUsername,
          suggestedName: parsedLink.name,
          suggestedUsername: parsedLink.username,
        });
        return true;
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
        domain, phone, post, comment, start, startattach, attach, thread, topic,
        appname, startapp, mode, story, text, free,
      } = params;

      const threadId = Number(thread) || Number(topic) || undefined;

      if (domain !== 'telegrampassport') {
        if (appname) {
          openChatByUsername({
            username: domain,
            startApp: startapp,
            mode,
            originalParts: [domain, appname],
            text,
          });
        } else if (phone) {
          openChatByPhoneNumber({
            phoneNumber: phone,
            startAttach: startattach,
            attach,
            text,
            noPaidMessagesToken: free || undefined,
          });
        } else if (story) {
          openStoryViewerByUsername({ username: domain, storyId: Number(story) });
        } else {
          openChatByUsername({
            username: domain,
            messageId: post ? Number(post) : undefined,
            commentId: comment ? Number(comment) : undefined,
            startParam: start,
            mode,
            startAttach: startattach,
            attach,
            threadId,
          });
        }
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

function parseChooseParameter(choose?: string) {
  if (!choose) return undefined;
  const types = choose.toLowerCase().split(' ').flatMap((type) => {
    if (type === 'groups') {
      return ['chats', 'groups'];
    }
    return [type];
  });
  return types.filter((type): type is ApiChatType => API_CHAT_TYPES.includes(type as ApiChatType));
}
