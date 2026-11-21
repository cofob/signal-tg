import type { MessageRecord } from '../../../lib/signal/db/MessageDb';
import type {
  AttachmentPointer, DataMessage, DataMessage_Contact, DataMessage_Sticker,
} from '../../../lib/signal/proto/generated/SignalService_pb';
import type { ApiContact, ApiSticker, ApiThumbnail, MediaContent } from '../../types';

import {
  SUPPORTED_AUDIO_CONTENT_TYPES, SUPPORTED_PHOTO_CONTENT_TYPES, SUPPORTED_VIDEO_CONTENT_TYPES,
} from '../../../config';
import { LONG_TEXT_CONTENT_TYPE } from '../../../lib/signal/messages/MessageProcessor';
import { AttachmentPointer_Flags } from '../../../lib/signal/proto/generated/SignalService_pb';
import { getBlurHashDataUri } from '../media/blurHash';

export const STICKER_SLOT = 's';

type AttachmentSlot = number | typeof STICKER_SLOT;

const MEDIA_ID_REGEX = /^(\d+)_(\d+|s)$/;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const PHOTO_CONTENT_TYPES = new Set([...SUPPORTED_PHOTO_CONTENT_TYPES, 'image/webp']);
// Signal Desktop `getFileExtension` in `ts/util/Attachment.std.ts`
const FILE_EXTENSIONS: Record<string, string> = {
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'image/jpeg': 'jpg',
};
const MS_PER_SECOND = 1000;
const DATE_PART_LENGTH = 2;
const MILLISECONDS_LENGTH = 3;
const FILE_INDEX_LENGTH = 3;
// Signal stickers are 512 × 512 pixels
const STICKER_SIZE = 512;
// `Contact` offers no chat for this id
const UNREGISTERED_CONTACT_ID = '0';
const NON_DIGIT_REGEX = /\D/g;
// Signal waveforms have a byte per bar; the app packs 5-bit bars
const BITS_PER_BYTE = 8;
const WAVEFORM_BAR_BITS = 5;
const BYTE_MASK = 0xFF;

/**
 * Media content of a message: photos, videos, documents, audio and voice notes, stickers and shared contacts.
 * Media ids encode the message id and attachment index, so `downloadMedia` can find the attachment pointer.
 */
export function buildMessageMedia(message: MessageRecord, dataMessage: DataMessage): MediaContent {
  const { sticker, attachments, contact } = dataMessage;
  if (sticker?.data) return { sticker: buildSticker(message, sticker, sticker.data) };

  // An app message holds one media item, so the first attachment stands for the others.
  // A long text attachment holds the body, not media.
  const index = attachments.findIndex(({ contentType }) => getMimeType(contentType) !== LONG_TEXT_CONTENT_TYPE);
  if (index !== -1) return buildAttachmentMedia(message, attachments[index], index);

  return contact.length ? { contact: buildContact(contact[0]) } : {};
}

/** The message id and attachment slot of a media id: an index in `DataMessage.attachments`, or the sticker */
export function parseAttachmentMediaId(mediaId: string): { messageId: number; slot: AttachmentSlot } | undefined {
  const match = mediaId.match(MEDIA_ID_REGEX);
  if (!match) return undefined;
  const [, messageId, slot] = match;
  return { messageId: Number(messageId), slot: slot === STICKER_SLOT ? STICKER_SLOT : Number(slot) };
}

function buildAttachmentMediaId(messageId: number, slot: AttachmentSlot) {
  return `${messageId}_${slot}`;
}

function buildAttachmentMedia(message: MessageRecord, pointer: AttachmentPointer, index: number): MediaContent {
  const id = buildAttachmentMediaId(message.id, index);
  const mimeType = getMimeType(pointer.contentType);
  const { size, width, height } = pointer;
  const fileName = pointer.fileName || getSuggestedFileName(mimeType, message.sentAt, index);
  const duration = Math.round(pointer.audioDurationSeconds);
  const isUnavailable = message.unavailableAttachmentIndexes?.includes(index) || undefined;

  // Legacy Android voice notes have no flag, only an audio type and no file name
  // (Signal Desktop `isVoiceMessage` in `ts/util/Attachment.std.ts`)
  if (hasFlag(pointer, AttachmentPointer_Flags.VOICE_MESSAGE) || (mimeType.startsWith('audio/') && !pointer.fileName)) {
    return {
      voice: {
        mediaType: 'voice', id, duration, waveform: buildWaveform(pointer.audioWaveform), size, isUnavailable,
      },
    };
  }

  if (PHOTO_CONTENT_TYPES.has(mimeType)) {
    return {
      photo: {
        mediaType: 'photo',
        id,
        date: Math.floor(message.sentAt / MS_PER_SECOND),
        thumbnail: buildThumbnail(pointer),
        sizes: width && height ? [{ type: 'x', width, height }] : [],
        isUnavailable,
      },
    };
  }

  if (SUPPORTED_VIDEO_CONTENT_TYPES.has(mimeType)) {
    return {
      video: {
        mediaType: 'video',
        id,
        mimeType,
        // Signal sends no video duration; the player reads it from the file
        duration: 0,
        fileName,
        width: width || undefined,
        height: height || undefined,
        isGif: hasFlag(pointer, AttachmentPointer_Flags.GIF) || undefined,
        thumbnail: buildThumbnail(pointer),
        size,
        isUnavailable,
      },
    };
  }

  if (SUPPORTED_AUDIO_CONTENT_TYPES.has(mimeType)) {
    return {
      audio: {
        mediaType: 'audio', id, size, mimeType, fileName, duration, isUnavailable,
      },
    };
  }

  return {
    document: {
      mediaType: 'document',
      id,
      fileName,
      size,
      timestamp: Math.floor(message.sentAt / MS_PER_SECOND),
      mimeType,
      isUnavailable,
    },
  };
}

function buildSticker(message: MessageRecord, sticker: DataMessage_Sticker, data: AttachmentPointer): ApiSticker {
  return {
    mediaType: 'sticker',
    id: buildAttachmentMediaId(message.id, STICKER_SLOT),
    // Sticker packs are not supported yet, so the sticker shows without its pack
    stickerSetInfo: { isMissing: true },
    emoji: sticker.emoji || undefined,
    isLottie: false,
    isVideo: false,
    width: data.width || STICKER_SIZE,
    height: data.height || STICKER_SIZE,
    isUnavailable: message.isStickerUnavailable,
  };
}

function buildContact({
  name, number, email, organization,
}: DataMessage_Contact): ApiContact {
  return {
    mediaType: 'contact',
    firstName: name?.givenName || name?.nickname || organization || email[0]?.value || '',
    lastName: name?.familyName ?? '',
    phoneNumber: number[0]?.value.replace(NON_DIGIT_REGEX, '') ?? '',
    // Shared contacts carry an ACI only sometimes, and resolving it to a user needs the database
    userId: UNREGISTERED_CONTACT_ID,
  };
}

/** The BlurHash as a thumbnail; its size is the media size, which layouts read before the media loads */
function buildThumbnail({ blurHash, width, height }: AttachmentPointer): ApiThumbnail | undefined {
  if (!blurHash || !width || !height) return undefined;
  const dataUri = getBlurHashDataUri(blurHash, width, height);
  return dataUri ? { dataUri, width, height } : undefined;
}

/** Packs Signal's 8-bit waveform bars into the app's 5-bit format (`decodeWaveform` in `src/util/waveform.ts`) */
function buildWaveform(bars: Uint8Array) {
  if (!bars.length) return undefined;
  const waveform = new Array<number>(Math.ceil((bars.length * WAVEFORM_BAR_BITS) / BITS_PER_BYTE)).fill(0);
  bars.forEach((bar, i) => {
    const value = bar >> (BITS_PER_BYTE - WAVEFORM_BAR_BITS);
    const bitOffset = i * WAVEFORM_BAR_BITS;
    const byteIndex = Math.floor(bitOffset / BITS_PER_BYTE);
    const bitShift = bitOffset % BITS_PER_BYTE;
    waveform[byteIndex] |= (value << bitShift) & BYTE_MASK;
    if (bitShift > BITS_PER_BYTE - WAVEFORM_BAR_BITS) {
      waveform[byteIndex + 1] |= value >> (BITS_PER_BYTE - bitShift);
    }
  });
  return waveform;
}

/**
 * A file name for attachments sent without one, such as photos and videos
 * (Signal Desktop `getSuggestedFilename` in `ts/util/Attachment.std.ts`)
 */
function getSuggestedFileName(mimeType: string, sentAt: number, index: number) {
  const date = new Date(sentAt);
  const dateParts = [
    date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(),
  ].map((part) => String(part).padStart(DATE_PART_LENGTH, '0'));
  const milliseconds = String(date.getMilliseconds()).padStart(MILLISECONDS_LENGTH, '0');
  const indexSuffix = index ? `_${String(index + 1).padStart(FILE_INDEX_LENGTH, '0')}` : '';
  const extension = FILE_EXTENSIONS[mimeType] ?? mimeType.split('/')[1];
  return `signal-${dateParts.join('-')}-${milliseconds}${indexSuffix}.${extension}`;
}

/** The base type of a content type, without parameters; attachments without one are binary files */
function getMimeType(contentType: string) {
  return contentType.split(';')[0].trim().toLowerCase() || DEFAULT_CONTENT_TYPE;
}

function hasFlag({ flags }: AttachmentPointer, flag: AttachmentPointer_Flags) {
  return Boolean(flags & flag);
}
