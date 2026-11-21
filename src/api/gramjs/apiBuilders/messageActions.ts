import { Api as GramJs } from '../../../lib/gramjs';

import type { ApiPhoneCallDiscardReason } from '../../types';
import type { ApiMessageAction } from '../../types/messageActions';

import { buildApiBotApp } from './bots';
import { buildApiPhoto } from './common';
import { buildPollAnswer } from './messageContent';
import { buildApiWallpaper } from './misc';
import { buildApiPeerId, getApiChatIdFromMtpPeer } from './peers';
import { buildApiBirthday } from './users';

const UNSUPPORTED_ACTION: ApiMessageAction = {
  mediaType: 'action',
  type: 'unsupported',
};

export function buildApiMessageAction(action: GramJs.TypeMessageAction): ApiMessageAction {
  if (action instanceof GramJs.MessageActionChatCreate) {
    const { title, users } = action;
    return {
      mediaType: 'action',
      type: 'chatCreate',
      title,
      userIds: users.map((u) => buildApiPeerId(u, 'user')),
    };
  }
  if (action instanceof GramJs.MessageActionChatEditTitle) {
    const { title } = action;
    return {
      mediaType: 'action',
      type: 'chatEditTitle',
      title,
    };
  }
  if (action instanceof GramJs.MessageActionChatEditPhoto) {
    const { photo } = action;

    return {
      mediaType: 'action',
      type: 'chatEditPhoto',
      photo: photo instanceof GramJs.Photo ? buildApiPhoto(photo) : undefined,
    };
  }
  if (action instanceof GramJs.MessageActionChatDeletePhoto) {
    return {
      mediaType: 'action',
      type: 'chatDeletePhoto',
    };
  }
  if (action instanceof GramJs.MessageActionChatAddUser) {
    const { users } = action;
    return {
      mediaType: 'action',
      type: 'chatAddUser',
      userIds: users.map((u) => buildApiPeerId(u, 'user')),
    };
  }
  if (action instanceof GramJs.MessageActionChatDeleteUser) {
    const { userId } = action;
    return {
      mediaType: 'action',
      type: 'chatDeleteUser',
      userId: buildApiPeerId(userId, 'user'),
    };
  }
  if (action instanceof GramJs.MessageActionChatJoinedViaCommunity) {
    return {
      mediaType: 'action',
      type: 'chatJoinedViaCommunity',
      communityId: buildApiPeerId(action.communityId, 'channel'),
    };
  }
  if (action instanceof GramJs.MessageActionChatJoinedByLink) {
    const { inviterId } = action;
    return {
      mediaType: 'action',
      type: 'chatJoinedByLink',
      inviterId: buildApiPeerId(inviterId, 'user'),
    };
  }
  if (action instanceof GramJs.MessageActionChannelCreate) {
    const { title } = action;
    return {
      mediaType: 'action',
      type: 'channelCreate',
      title,
    };
  }
  if (action instanceof GramJs.MessageActionChatMigrateTo) {
    const { channelId } = action;
    return {
      mediaType: 'action',
      type: 'chatMigrateTo',
      channelId: buildApiPeerId(channelId, 'channel'),
    };
  }
  if (action instanceof GramJs.MessageActionChannelMigrateFrom) {
    const { title, chatId } = action;
    return {
      mediaType: 'action',
      type: 'channelMigrateFrom',
      title,
      chatId: buildApiPeerId(chatId, 'chat'),
    };
  }
  if (action instanceof GramJs.MessageActionChangeCommunity) {
    const { communityId } = action;
    return {
      mediaType: 'action',
      type: 'changeCommunity',
      communityId: communityId !== undefined ? buildApiPeerId(communityId, 'channel') : undefined,
    };
  }
  if (action instanceof GramJs.MessageActionPinMessage) {
    return {
      mediaType: 'action',
      type: 'pinMessage',
    };
  }
  if (action instanceof GramJs.MessageActionHistoryClear) {
    return {
      mediaType: 'action',
      type: 'historyClear',
    };
  }
  if (action instanceof GramJs.MessageActionSetMessagesTTL) {
    const { period, autoSettingFrom } = action;

    return {
      mediaType: 'action',
      type: 'setMessagesTtl',
      period,
      autoSettingFromId: autoSettingFrom?.toString(),
    };
  }
  if (action instanceof GramJs.MessageActionSetChatTheme) {
    const { theme } = action;
    if (theme instanceof GramJs.ChatTheme) {
      return {
        mediaType: 'action',
        type: 'setChatTheme',
        emoticon: theme.emoticon || undefined,
      };
    }
    return UNSUPPORTED_ACTION;
  }
  if (action instanceof GramJs.MessageActionSetChatWallPaper) {
    return {
      mediaType: 'action',
      type: 'setChatWallpaper',
      isSame: action.same,
      isForBoth: action.forBoth,
      wallpaper: !action.same ? buildApiWallpaper(action.wallpaper) : undefined,
    };
  }
  if (action instanceof GramJs.MessageActionGameScore) {
    const { gameId, score } = action;
    return {
      mediaType: 'action',
      type: 'gameScore',
      gameId: gameId.toString(),
      score,
    };
  }
  if (action instanceof GramJs.MessageActionPhoneCall) {
    const {
      video, callId, reason, duration,
    } = action;
    return {
      mediaType: 'action',
      type: 'phoneCall',
      isVideo: video,
      callId: callId.toString(),
      reason: reason && buildApiPhoneCallDiscardReason(reason),
      duration,
    };
  }
  if (action instanceof GramJs.MessageActionScreenshotTaken) {
    return {
      mediaType: 'action',
      type: 'screenshotTaken',
    };
  }
  if (action instanceof GramJs.MessageActionCustomAction) {
    const { message } = action;
    return {
      mediaType: 'action',
      type: 'customAction',
      message,
    };
  }
  if (action instanceof GramJs.MessageActionBotAllowed) {
    const {
      attachMenu, fromRequest, domain, app,
    } = action;
    return {
      mediaType: 'action',
      type: 'botAllowed',
      isAttachMenu: attachMenu,
      isFromRequest: fromRequest,
      domain,
      app: app && buildApiBotApp(app),
    };
  }
  if (action instanceof GramJs.MessageActionRequestedPeer) {
    return {
      mediaType: 'action',
      type: 'requestedPeer',
      peerIds: action.peers.map(getApiChatIdFromMtpPeer),
    };
  }
  if (action instanceof GramJs.MessageActionManagedBotCreated) {
    return {
      mediaType: 'action',
      type: 'managedBotCreated',
      botId: buildApiPeerId(action.botId, 'user'),
    };
  }
  if (action instanceof GramJs.MessageActionContactSignUp) {
    return {
      mediaType: 'action',
      type: 'contactSignUp',
    };
  }
  if (action instanceof GramJs.MessageActionGroupCall) {
    const { call, duration } = action;
    if (!(call instanceof GramJs.InputGroupCall)) {
      return UNSUPPORTED_ACTION;
    }
    return {
      mediaType: 'action',
      type: 'groupCall',
      call: {
        id: call.id.toString(),
        accessHash: call.accessHash.toString(),
      },
      duration,
    };
  }
  if (action instanceof GramJs.MessageActionInviteToGroupCall) {
    const { call, users } = action;
    if (!(call instanceof GramJs.InputGroupCall)) {
      return UNSUPPORTED_ACTION;
    }
    return {
      mediaType: 'action',
      type: 'inviteToGroupCall',
      call: {
        id: call.id.toString(),
        accessHash: call.accessHash.toString(),
      },
      userIds: users.map((u) => buildApiPeerId(u, 'user')),
    };
  }
  if (action instanceof GramJs.MessageActionGroupCallScheduled) {
    const { call, scheduleDate } = action;
    if (!(call instanceof GramJs.InputGroupCall)) {
      return UNSUPPORTED_ACTION;
    }
    return {
      mediaType: 'action',
      type: 'groupCallScheduled',
      call: {
        id: call.id.toString(),
        accessHash: call.accessHash.toString(),
      },
      scheduleDate,
    };
  }
  if (action instanceof GramJs.MessageActionChatJoinedByRequest) {
    return {
      mediaType: 'action',
      type: 'chatJoinedByRequest',
    };
  }
  if (action instanceof GramJs.MessageActionWebViewDataSent) {
    const { text } = action;
    return {
      mediaType: 'action',
      type: 'webViewDataSent',
      text,
    };
  }
  if (action instanceof GramJs.MessageActionTopicCreate) {
    const { title, iconColor, iconEmojiId } = action;
    return {
      mediaType: 'action',
      type: 'topicCreate',
      title,
      iconColor,
      iconEmojiId: iconEmojiId?.toString(),
    };
  }
  if (action instanceof GramJs.MessageActionTopicEdit) {
    const {
      title, iconEmojiId, closed, hidden,
    } = action;
    return {
      mediaType: 'action',
      type: 'topicEdit',
      title,
      iconEmojiId: iconEmojiId?.toString(),
      isClosed: closed,
      isHidden: hidden,
    };
  }
  if (action instanceof GramJs.MessageActionSuggestProfilePhoto) {
    const { photo } = action;

    if (!(photo instanceof GramJs.Photo)) return UNSUPPORTED_ACTION;

    return {
      mediaType: 'action',
      type: 'suggestProfilePhoto',
      photo: buildApiPhoto(photo),
    };
  }
  if (action instanceof GramJs.MessageActionSuggestBirthday) {
    return {
      mediaType: 'action',
      type: 'suggestBirthday',
      birthday: buildApiBirthday(action.birthday),
    };
  }
  if (action instanceof GramJs.MessageActionPollAppendAnswer) {
    const answer = buildPollAnswer(action.answer);
    if (!answer) return UNSUPPORTED_ACTION;

    return {
      mediaType: 'action',
      type: 'pollAppendAnswer',
      answer,
    };
  }
  if (action instanceof GramJs.MessageActionPollDeleteAnswer) {
    const answer = buildPollAnswer(action.answer);
    if (!answer) return UNSUPPORTED_ACTION;

    return {
      mediaType: 'action',
      type: 'pollDeleteAnswer',
      answer,
    };
  }
  if (action instanceof GramJs.MessageActionNewCreatorPending) {
    const { newCreatorId } = action;
    return {
      mediaType: 'action',
      type: 'newCreatorPending',
      newCreatorId: buildApiPeerId(newCreatorId, 'user'),
    };
  }
  if (action instanceof GramJs.MessageActionChangeCreator) {
    const { newCreatorId } = action;
    return {
      mediaType: 'action',
      type: 'changeCreator',
      newCreatorId: buildApiPeerId(newCreatorId, 'user'),
    };
  }
  if (action instanceof GramJs.MessageActionNoForwardsToggle) {
    const { prevValue, newValue } = action;
    return {
      mediaType: 'action',
      type: 'noForwardsToggle',
      prevValue: Boolean(prevValue),
      newValue: Boolean(newValue),
    };
  }
  if (action instanceof GramJs.MessageActionNoForwardsRequest) {
    const { expired, prevValue, newValue } = action;
    return {
      mediaType: 'action',
      type: 'noForwardsRequest',
      isExpired: expired,
      prevValue: Boolean(prevValue),
      newValue: Boolean(newValue),
    };
  }

  return UNSUPPORTED_ACTION;
}

export function buildApiPhoneCallDiscardReason(reason: GramJs.TypePhoneCallDiscardReason): ApiPhoneCallDiscardReason {
  if (reason instanceof GramJs.PhoneCallDiscardReasonBusy) {
    return 'busy';
  }
  if (reason instanceof GramJs.PhoneCallDiscardReasonHangup) {
    return 'hangup';
  }
  if (reason instanceof GramJs.PhoneCallDiscardReasonMissed) {
    return 'missed';
  }

  return 'disconnect';
}
