import { clone } from '@bufbuild/protobuf';

import type {
  DataMessage,
  SyncMessage_AttachmentBackfillResponse_AttachmentData as AttachmentData,
  SyncMessage_AttachmentBackfillResponse_AttachmentDataList as AttachmentDataList,
} from '../proto/generated/SignalService_pb';

import {
  DataMessageSchema,
  SyncMessage_AttachmentBackfillResponse_AttachmentData_Status as BackfillStatus,
} from '../proto/generated/SignalService_pb';

// Signal Desktop `REQUEST_TIMEOUT` in `ts/jobs/helpers/attachmentBackfill.preload.ts`: how long the phone has to answer
export const ATTACHMENT_BACKFILL_TIMEOUT_MS = 10 * 1000;

/** What a backfill response made of a message's attachments */
export type BackfillResult = {
  dataMessage: DataMessage;
  // Indexes in `DataMessage.attachments` that are still unavailable
  unavailableAttachmentIndexes: number[];
  isStickerUnavailable: boolean;
  // Attachments that the phone is still working on, and that it gave up on
  pendingCount: number;
  failedCount: number;
  // Whether the message changed
  isChanged: boolean;
};

/**
 * Applies the response of the primary device to a request for the attachments of a message (Signal Desktop
 * `AttachmentBackfill.handleResponse` in `ts/jobs/helpers/attachmentBackfill.preload.ts`). The response lists the
 * sticker first, if the message has one, then the attachments in order without the long text, which has an entry of
 * its own; the long text is the attachment of `longTextContentType` here, where it is part of the list. A new pointer
 * replaces the old one of an attachment that is unavailable, or that the request was for, unless the attachment is
 * downloaded already (Desktop `isDownloaded`): its cached copy is found by its pointer.
 */
export function applyBackfillResponse({
  dataMessage, unavailableAttachmentIndexes, isStickerUnavailable, isRequested, response, longTextContentType,
  downloadedAttachmentIndexes, isStickerDownloaded,
}: {
  dataMessage: DataMessage;
  unavailableAttachmentIndexes: number[];
  isStickerUnavailable: boolean;
  isRequested: boolean;
  response: AttachmentDataList;
  longTextContentType: string;
  // Indexes in `DataMessage.attachments` that are downloaded, and whether the sticker is
  downloadedAttachmentIndexes: Set<number>;
  isStickerDownloaded: boolean;
}): BackfillResult {
  const message = clone(DataMessageSchema, dataMessage);
  const unavailable = new Set(unavailableAttachmentIndexes);
  const result: BackfillResult = {
    dataMessage: message,
    unavailableAttachmentIndexes,
    isStickerUnavailable,
    pendingCount: 0,
    failedCount: 0,
    isChanged: false,
  };

  const remote = [...response.attachments];
  if (message.sticker?.data) {
    const entry = remote.shift();
    if (entry && !isStickerDownloaded) {
      const pointer = readEntry(entry, result);
      if (pointer && (isStickerUnavailable || isRequested)) {
        message.sticker.data = pointer;
        result.isStickerUnavailable = false;
        result.isChanged = true;
      }
    }
  }

  const bodyIndex = message.attachments.findIndex(({ contentType }) => contentType === longTextContentType);
  const replace = (index: number, entry: AttachmentData) => {
    if (downloadedAttachmentIndexes.has(index)) return;
    const pointer = readEntry(entry, result);
    if (!pointer || !(unavailable.has(index) || isRequested)) return;
    message.attachments[index] = pointer;
    unavailable.delete(index);
    result.isChanged = true;
  };

  if (response.longText && bodyIndex >= 0) replace(bodyIndex, response.longText);
  const indexes = message.attachments.map((_, index) => index).filter((index) => index !== bodyIndex);
  for (const [position, entry] of remote.entries()) {
    // The phone knows attachments that this device does not have a place for
    if (position < indexes.length) replace(indexes[position], entry);
  }

  result.unavailableAttachmentIndexes = [...unavailable];
  return result;
}

/** The pointer of an entry; entries without one count as pending or failed */
function readEntry({ data }: AttachmentData, result: BackfillResult) {
  if (data.case === 'attachment') return data.value;
  if (data.case === 'status') {
    if (data.value === BackfillStatus.TERMINAL_ERROR) result.failedCount++;
    else result.pendingCount++;
  }
  return undefined;
}
