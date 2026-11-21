import { memo, type TeactNode } from '../../../lib/teact/teact';
import { getGlobal, withGlobal } from '../../../global';

import type { ApiChat, ApiMessage, ApiPeer } from '../../../api/types';

import {
  getMessageTextWithFallback,
  isChatBasicGroup,
} from '../../../global/helpers';
import { getPeerTitle } from '../../../global/helpers/peers';
import { getMessageReplyInfo } from '../../../global/helpers/replies';
import {
  selectChat,
  selectChatMessage,
  selectPeer,
  selectSender,
} from '../../../global/selectors';
import { formatCountdown } from '../../../util/dates/duration';
import { conjuctionWithNodes } from '../../../util/localization/utils';
import renderText from '../../common/helpers/renderText';
import { renderTextWithEntities } from '../../common/helpers/renderTextWithEntities';
import {
  getPinnedMediaValue,
  renderMessageLink,
  renderPeerLink,
  translateWithYou,
} from './helpers/messageActions';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import styles from './ActionMessage.module.scss';

type OwnProps = {
  message: ApiMessage;
  asPreview?: boolean;
};

type StateProps = {
  currentUserId?: string;
  sender?: ApiPeer;
  replyMessage?: ApiMessage;
  chat?: ApiChat;
};

const UNSUPPORTED_LANG_KEY = 'ActionUnsupported';
// Signal group updates whose text names only who made them
const GROUP_UPDATE_LANG_KEYS = {
  description: 'ActionGroupDescription',
  descriptionRemoved: 'ActionGroupDescriptionRemoved',
  inviteDeclined: 'ActionGroupInviteDeclined',
  joinRequested: 'ActionGroupJoinRequested',
  joinCanceled: 'ActionGroupJoinCanceled',
  linkOn: 'ActionGroupLinkOn',
  linkOnWithApproval: 'ActionGroupLinkOnWithApproval',
  linkOff: 'ActionGroupLinkOff',
  linkReset: 'ActionGroupLinkReset',
  announcementsOn: 'ActionGroupAnnouncementsOn',
  announcementsOff: 'ActionGroupAnnouncementsOff',
  terminated: 'ActionGroupTerminated',
} as const;

const ActionMessageText = ({
  message,
  currentUserId,
  sender,
  chat,
  replyMessage,
  asPreview,
}: OwnProps & StateProps) => {
  const { isOutgoing } = message;
  const action = message.content.action!;

  const lang = useLang();

  function renderStrong(text: TeactNode) {
    if (asPreview) return text;
    return <span className={styles.strong}>{text}</span>;
  }

  const renderActionText = useLastCallback(() => {
    const global = getGlobal();

    const isSenderSelf = sender ? sender.id === currentUserId : isOutgoing;
    const senderTitle = sender && getPeerTitle(lang, sender);
    const chatTitle = chat && getPeerTitle(lang, chat);

    const userFallbackText = lang('ActionFallbackUser');

    const senderLink = renderPeerLink(sender?.id, senderTitle || userFallbackText, asPreview);

    switch (action.type) {
      case 'pinMessage': {
        if (replyMessage) {
          const formattedText = getMessageTextWithFallback(lang, replyMessage);
          if (formattedText) {
            const textLink = renderMessageLink(
              replyMessage,
              renderTextWithEntities({
                text: formattedText.text,
                entities: formattedText.entities,
                asPreview: true,
              }),
              asPreview,
            );

            return translateWithYou(
              lang, 'ActionPinnedText', isOutgoing, { text: textLink, from: senderLink },
            );
          }

          const mediaValue = getPinnedMediaValue(lang, replyMessage);
          if (mediaValue) {
            const messageLink = renderMessageLink(replyMessage, mediaValue, asPreview);
            return translateWithYou(
              lang, 'ActionPinnedMedia', isOutgoing, { from: senderLink, media: messageLink },
            );
          }
        }

        return translateWithYou(
          lang,
          'ActionPinnedNotFound',
          isOutgoing,
          { from: senderLink },
        );
      }

      case 'chatJoinedByLink':
        return lang('ActionUserJoinedByLink', { from: senderLink }, { withNodes: true });

      case 'chatJoinedByRequest':
        return translateWithYou(lang, 'ActionJoinedByRequest', isOutgoing, { from: senderLink });

      case 'groupUpdate': {
        const user = action.userId ? selectPeer(global, action.userId) : undefined;
        const userLink = renderPeerLink(user?.id, (user && getPeerTitle(lang, user)) || userFallbackText, asPreview);
        const access = lang(action.isAdminOnly ? 'ActionGroupAccessAdmins' : 'ActionGroupAccessMembers');
        switch (action.update) {
          case 'adminAdded':
            return translateWithYou(lang, 'ActionGroupAdminAdded', isSenderSelf, { from: senderLink, user: userLink });
          case 'adminRemoved':
            return translateWithYou(
              lang, 'ActionGroupAdminRemoved', isSenderSelf, { from: senderLink, user: userLink },
            );
          case 'invited':
            return translateWithYou(lang, 'ActionGroupInvited', isSenderSelf, {
              from: senderLink, count: action.count ?? 0,
            }, { pluralValue: action.count ?? 0 });
          case 'inviteRevoked':
            return translateWithYou(lang, 'ActionGroupInviteRevoked', isSenderSelf, {
              from: senderLink, count: action.count ?? 0,
            }, { pluralValue: action.count ?? 0 });
          case 'joinDenied':
            return translateWithYou(lang, 'ActionGroupJoinDenied', isSenderSelf, { from: senderLink, user: userLink });
          case 'infoAccess':
            return translateWithYou(lang, 'ActionGroupInfoAccess', isSenderSelf, { from: senderLink, access });
          case 'membersAccess':
            return translateWithYou(lang, 'ActionGroupMembersAccess', isSenderSelf, { from: senderLink, access });
          case 'labelAccess':
            return translateWithYou(lang, 'ActionGroupLabelAccess', isSenderSelf, { from: senderLink, access });
          default:
            return translateWithYou(lang, GROUP_UPDATE_LANG_KEYS[action.update], isSenderSelf, { from: senderLink });
        }
      }

      case 'chatEditTitle': {
        const { title } = action;
        return translateWithYou(lang, 'ActionChangedTitle', isOutgoing, { title, from: senderLink });
      }

      case 'chatDeletePhoto':
        return translateWithYou(lang, 'ActionRemovedPhoto', isOutgoing, { from: senderLink });

      case 'chatEditPhoto':
        return translateWithYou(lang, 'ActionChangedPhoto', isOutgoing, { from: senderLink });

      case 'setChatTheme': {
        const themeName = action.emoticon;
        if (!themeName) {
          return translateWithYou(lang, 'ActionDisabledTheme', isSenderSelf, { from: senderLink });
        }
        const theme = renderStrong(renderText(themeName));
        return translateWithYou(lang, 'ActionChangedTheme', isSenderSelf, { from: senderLink, theme });
      }

      case 'setChatWallpaper': {
        if (action.isSame) {
          return translateWithYou(lang, 'ActionSetSameWallpaper', isSenderSelf, { from: senderLink });
        }
        if (isSenderSelf && action.isForBoth) {
          return lang('ActionChangedWallpaperBothYou', {
            peer: renderStrong(chatTitle || userFallbackText),
          }, { withNodes: true });
        }
        if (chat && isChatBasicGroup(chat)) {
          return lang(isSenderSelf ? 'ActionChangedWallpaperGroupYou' : 'ActionChangedWallpaperGroup');
        }
        return translateWithYou(lang, 'ActionChangedWallpaper', isSenderSelf, { from: senderLink });
      }

      case 'chatCreate': {
        const { title } = action;
        return lang('ActionCreatedChat', { title, from: senderLink }, { withNodes: true });
      }

      case 'chatAddUser': {
        const { userIds } = action;

        if (sender?.id === userIds[0]) {
          return translateWithYou(lang, 'ActionUserJoined', isOutgoing, { from: senderLink });
        }

        if (userIds.length === 1) {
          const user = selectPeer(global, userIds[0]);
          const userTitle = (user && getPeerTitle(lang, user)) || userFallbackText;
          const userLink = renderPeerLink(user?.id, userTitle, asPreview);
          return translateWithYou(lang, 'ActionAddUser', isOutgoing, { from: senderLink, user: userLink });
        }

        const users = userIds.map((userId) => selectPeer(global, userId)).filter(Boolean);

        if (!users.length) {
          return translateWithYou(lang, 'ActionAddUser', isOutgoing, { from: senderLink, user: userFallbackText });
        }

        const userLinks = users.map((user) => (
          renderPeerLink(user.id, getPeerTitle(lang, user) || userFallbackText, asPreview)
        ));

        return translateWithYou(
          lang, 'ActionAddUsersMany', isOutgoing, { from: senderLink, users: conjuctionWithNodes(lang, userLinks) },
        );
      }

      case 'chatDeleteUser': {
        const { userId } = action;
        if (sender?.id === userId) {
          return translateWithYou(lang, 'ActionUserLeft', isOutgoing, { from: senderLink });
        }

        const user = selectPeer(global, userId);
        const userTitle = (user && getPeerTitle(lang, user)) || userFallbackText;
        const userLink = renderPeerLink(user?.id, userTitle, asPreview);
        return translateWithYou(lang, 'ActionKickUser', isOutgoing, { from: senderLink, user: userLink });
      }

      case 'suggestProfilePhoto': {
        const actionPeer = (isOutgoing ? chat : sender)!;
        const actionPeerLink = renderPeerLink(
          actionPeer.id, getPeerTitle(lang, actionPeer) || userFallbackText, asPreview,
        );

        return translateWithYou(lang, 'ActionSuggestedPhoto', isOutgoing, { user: actionPeerLink });
      }

      case 'suggestBirthday': {
        const actionPeer = (isOutgoing ? chat : sender)!;
        const actionPeerLink = renderPeerLink(
          actionPeer.id, getPeerTitle(lang, actionPeer) || userFallbackText, asPreview,
        );

        return translateWithYou(lang, 'ActionSuggestedBirthday', isOutgoing, { user: actionPeerLink });
      }

      case 'expired': {
        const { isRoundVideo, isVoice } = action;
        if (isVoice) return lang('ActionExpiredVoice');
        if (isRoundVideo) return lang('ActionExpiredVideo');

        return lang(UNSUPPORTED_LANG_KEY);
      }

      case 'historyClear':
        return lang('ActionHistoryCleared');

      // Signal Desktop `getMessageStatusContents` in `ts/components/conversation/Message.dom.tsx`
      case 'deleted': {
        const { adminId } = action;
        if (adminId && adminId !== currentUserId) {
          const admin = selectPeer(global, adminId);
          const adminTitle = (admin && getPeerTitle(lang, admin)) || userFallbackText;
          const adminLink = renderPeerLink(adminId, adminTitle, asPreview);
          return lang('ActionMessageDeletedByAdmin', { admin: adminLink }, { withNodes: true });
        }
        return translateWithYou(lang, 'ActionMessageDeleted', isOutgoing || Boolean(adminId), { from: senderLink });
      }

      // Signal Desktop `ts/components/conversation/Message.dom.tsx` (`#renderTapToViewText`)
      case 'viewOnce':
        if (action.isViewed) return lang('ActionViewOnceViewed');
        if (action.media) {
          return lang(action.media.mediaType === 'video' ? 'ActionViewOnceVideo' : 'ActionViewOncePhoto');
        }
        return lang('ActionViewOnceMedia');

      case 'safetyNumberChange':
        return lang('ActionSafetyChanged', { user: senderLink }, { withNodes: true });

      case 'safetyNumberVerified': {
        const key = action.isVerified
          ? (action.isFromOtherDevice ? 'ActionSafetyVerifiedSynced' : 'ActionSafetyVerified')
          : (action.isFromOtherDevice ? 'ActionSafetyUnverifiedSynced' : 'ActionSafetyUnverified');
        return lang(key, { user: senderLink }, { withNodes: true });
      }

      case 'setMessagesTtl': {
        const { period, autoSettingFromId } = action;

        if (period === 0) {
          return isOutgoing
            ? lang('ActionTTLYouDisabled')
            : lang('ActionTTLDisabled', { from: senderLink }, { withNodes: true });
        }

        const time = formatCountdown(lang, period);
        if (autoSettingFromId) {
          if (autoSettingFromId === currentUserId) {
            return lang('AutoDeleteGlobalActionFromYou', { time });
          }

          const autoSettingFrom = selectPeer(global, autoSettingFromId);
          const autoSettingFromTitle = autoSettingFrom && getPeerTitle(lang, autoSettingFrom);
          const autoSettingFromLink = renderPeerLink(
            autoSettingFrom?.id,
            autoSettingFromTitle || userFallbackText,
            asPreview,
          );

          return lang(
            'AutoDeleteGlobalAction',
            { from: autoSettingFromLink, time },
            { withNodes: true },
          );
        }

        return isOutgoing
          ? lang('ActionTTLYouChanged', { time })
          : lang('ActionTTLChanged', { from: senderLink, time }, { withNodes: true });
      }

      case 'screenshotTaken':
        return translateWithYou(lang, 'ActionScreenshotTaken', isOutgoing, { from: senderLink });

      case 'contactSignUp':
        return lang('ActionUserRegistered', { from: senderLink }, { withNodes: true });

      case 'customAction':
        return action.message;

      case 'pollAppendAnswer':
      case 'pollDeleteAnswer': {
        const optionLink = renderMessageLink(
          replyMessage,
          renderTextWithEntities({
            text: action.answer.text.text,
            entities: action.answer.text.entities,
            asPreview: true,
          }),
          asPreview,
        );

        return translateWithYou(
          lang,
          action.type === 'pollAppendAnswer' ? 'MessageActionPollAppendAnswer' : 'MessageActionPollDeleteAnswer',
          isOutgoing,
          {
            peer: senderLink,
            option: optionLink,
          },
        );
      }

      case 'noForwardsToggle': {
        const { prevValue, newValue } = action;
        if (newValue && newValue === prevValue) {
          return lang('ActionSharingStillDisabled');
        }
        return translateWithYou(
          lang,
          newValue ? 'ActionSharingDisabled' : 'ActionSharingEnabled',
          isOutgoing,
          { from: senderLink },
        );
      }

      case 'noForwardsRequest': {
        return isOutgoing
          ? lang('NoForwardsRequestYouTitle')
          : lang('NoForwardsRequestTitle', { user: senderLink }, { withNodes: true });
      }

      default:
        return lang(UNSUPPORTED_LANG_KEY);
    }
  });

  return renderActionText();
};

export default memo(withGlobal<OwnProps>(
  (global, { message }): Complete<StateProps> => {
    const chat = selectChat(global, message.chatId);
    const sender = selectSender(global, message);

    const { replyToMsgId, replyToPeerId } = getMessageReplyInfo(message) || {};
    const replyMessage = replyToMsgId
      ? selectChatMessage(global, replyToPeerId || message.chatId, replyToMsgId) : undefined;

    return {
      currentUserId: global.currentUserId,
      replyMessage,
      chat,
      sender,
    };
  },
)(ActionMessageText));
