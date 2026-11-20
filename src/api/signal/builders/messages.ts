import { fromBinary } from '@bufbuild/protobuf';

import type { ConversationRecord, MessageRecord } from '../../../lib/signal/db/MessageDb';
import type { ApiMessage } from '../../types';

import { DataMessageSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import { getPeerId, getUserPeerId } from '../peers';
import { buildMessageMedia } from './media';

/** Builds the app message of a stored Signal message; `conversation` is the one it belongs to */
export async function buildApiMessage(message: MessageRecord, conversation: ConversationRecord): Promise<ApiMessage> {
  const dataMessage = message.dataMessage ? fromBinary(DataMessageSchema, message.dataMessage) : undefined;
  const authorAci = message.authorAci || message.actorAci;
  const media = dataMessage ? buildMessageMedia(message, dataMessage) : undefined;
  return {
    id: message.id,
    chatId: getPeerId(conversation),
    date: Math.floor(message.sentAt / 1000),
    isOutgoing: message.isOutgoing,
    senderId: authorAci ? await getUserPeerId(authorAci) : undefined,
    content: {
      ...media,
      text: message.body ? { text: message.body } : undefined,
    },
  };
}
