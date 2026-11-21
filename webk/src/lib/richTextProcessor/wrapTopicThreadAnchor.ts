import getServerMessageId from '@appManagers/utils/messageId/getServerMessageId';
import wrapTelegramUrlToAnchor from '@lib/richTextProcessor/wrapTelegramUrlToAnchor';

type WrapTopicThreadAnchorArgs = {
  peerId: PeerId;
  threadId: number;
  lastMsgId: number;
};

export default function wrapTopicThreadAnchor({peerId, threadId, lastMsgId}: WrapTopicThreadAnchorArgs) {
  return wrapTelegramUrlToAnchor(
    't-me.invalid/c/' +
    peerId.toChatId() +
    (threadId ? '/' + getServerMessageId(threadId) : '') +
    (lastMsgId ? '/' + getServerMessageId(lastMsgId) : '')
  );
}
