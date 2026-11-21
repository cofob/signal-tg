import type { ApiMessage } from '../../api/types';
import type { SendMessageParams } from '../../types';

import { isUserId } from '../../util/entities/ids';

export function buildAnchoredEphemeralMessage(anchor: ApiMessage, ephemeral: ApiMessage): ApiMessage {
  return {
    ...ephemeral,
    id: anchor.id,
    ephemeralId: ephemeral.id,
    date: anchor.date,
    senderId: anchor.senderId,
    isOutgoing: anchor.isOutgoing,
    replyInfo: anchor.replyInfo,
    forwardInfo: anchor.forwardInfo,
    postAuthorTitle: anchor.postAuthorTitle,
    fromRank: anchor.fromRank,
    viewsCount: anchor.viewsCount,
    forwardsCount: anchor.forwardsCount,
    hasUnreadMention: anchor.hasUnreadMention,
    isProtected: anchor.isProtected || ephemeral.isProtected,
    isPinned: anchor.isPinned,
  };
}

export function isMessageLocalOnly(message: ApiMessage) {
  return Boolean(message.isEphemeral && !message.anchorMsgId);
}

export function getCanReplyToEphemeralMessage(message: ApiMessage) {
  return Boolean(
    message.isEphemeral
    && !message.anchorMsgId
    && !message.isOutgoing
    && message.ephemeralBotId
    && isUserId(message.ephemeralBotId),
  );
}

export function isEphemeralSendSupported({
  scheduledAt, contact, dice, poll, story,
}: SendMessageParams) {
  return !scheduledAt && !(
    contact
    || dice
    || poll
    || story
  );
}
