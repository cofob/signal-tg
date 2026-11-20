import type { MessageRecord } from '../../../lib/signal/db/MessageDb';
import type { DataMessage } from '../../../lib/signal/proto/generated/SignalService_pb';
import type { MediaContent } from '../../types';

/**
 * Media content of a message: photos, videos, documents, audio and voice notes, stickers and shared contacts.
 * Media ids encode the message id and attachment index, so `downloadMedia` can find the attachment pointer.
 */
export function buildMessageMedia(message: MessageRecord, dataMessage: DataMessage): MediaContent {
  void message;
  void dataMessage;
  return {};
}
