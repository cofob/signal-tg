import type { MessageInitShape } from '@bufbuild/protobuf';

import type { AttachmentPointerSchema } from '../../lib/signal/proto/generated/SignalService_pb';
import type { ApiAttachment, ApiOnProgress } from '../types';

/** Uploads an attachment that the composer prepared and returns its pointer for `DataMessage.attachments` */
export function uploadMessageAttachment(
  attachment: ApiAttachment, onProgress?: ApiOnProgress,
): Promise<MessageInitShape<typeof AttachmentPointerSchema>> {
  void attachment;
  void onProgress;
  return Promise.reject(new Error('Attachment upload is not implemented yet'));
}
