import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type { MessageRecord, NewMessageRecord, SendStatus as RecordSendStatus } from '../db/MessageDb';
import type { PinnedMessage } from '../messages/MessageProcessor';
import type {
  BodyRange as BackupBodyRange,
  ChatItem,
  ContactAttachment,
  FilePointer,
  GroupChangeChatUpdate,
  MessageAttachment,
  Poll,
  Quote,
  Reaction,
  SendStatus,
  StandardMessage,
  Sticker,
} from '../proto/generated/Backup_pb';
import type { BodyRange } from '../proto/generated/SignalService_pb';

import { uuidToString } from '../serviceId';

import { LONG_TEXT_CONTENT_TYPE } from '../messages/MessageProcessor';
import {
  BodyRange_Style as BackupBodyRangeStyle,
  ContactAttachment_Email_Type as BackupEmailType,
  ContactAttachment_Phone_Type as BackupPhoneType,
  ContactAttachment_PostalAddress_Type as BackupAddressType,
  MessageAttachment_Flag,
  Quote_Type,
} from '../proto/generated/Backup_pb';
import {
  AttachmentPointer_Flags,
  AttachmentPointerSchema,
  BodyRange_Style,
  BodyRangeSchema,
  DataMessage_Contact_Email_Type as EmailType,
  DataMessage_Contact_Phone_Type as PhoneType,
  DataMessage_Contact_PostalAddress_Type as AddressType,
  DataMessage_Quote_Type,
  DataMessageSchema,
} from '../proto/generated/SignalService_pb';

/** What chat items refer to: recipients and chats of the backup by their ids within the file */
export type ChatItemContext = {
  selfAci: string;
  recipientAcis: Map<bigint, string>;
  chatConversationIds: Map<bigint, string>;
  // Milliseconds since the epoch on the server clock
  now: number;
};

export type ConvertedChatItem = {
  record: NewMessageRecord;
  pin?: PinnedMessage;
};

type DataMessageInit = MessageInitShape<typeof DataMessageSchema>;

const MS_PER_SECOND = 1000;
const ATTACHMENT_FLAGS: Record<MessageAttachment_Flag, number> = {
  [MessageAttachment_Flag.NONE]: 0,
  [MessageAttachment_Flag.VOICE_MESSAGE]: AttachmentPointer_Flags.VOICE_MESSAGE,
  [MessageAttachment_Flag.BORDERLESS]: AttachmentPointer_Flags.BORDERLESS,
  [MessageAttachment_Flag.GIF]: AttachmentPointer_Flags.GIF,
};
const BODY_RANGE_STYLES: Record<BackupBodyRangeStyle, BodyRange_Style> = {
  [BackupBodyRangeStyle.NONE]: BodyRange_Style.NONE,
  [BackupBodyRangeStyle.BOLD]: BodyRange_Style.BOLD,
  [BackupBodyRangeStyle.ITALIC]: BodyRange_Style.ITALIC,
  [BackupBodyRangeStyle.SPOILER]: BodyRange_Style.SPOILER,
  [BackupBodyRangeStyle.STRIKETHROUGH]: BodyRange_Style.STRIKETHROUGH,
  [BackupBodyRangeStyle.MONOSPACE]: BodyRange_Style.MONOSPACE,
};
// `UNKNOWN` means the first type in the backup schema
const PHONE_TYPES: Record<BackupPhoneType, PhoneType> = {
  [BackupPhoneType.UNKNOWN]: PhoneType.HOME,
  [BackupPhoneType.HOME]: PhoneType.HOME,
  [BackupPhoneType.MOBILE]: PhoneType.MOBILE,
  [BackupPhoneType.WORK]: PhoneType.WORK,
  [BackupPhoneType.CUSTOM]: PhoneType.CUSTOM,
};
const EMAIL_TYPES: Record<BackupEmailType, EmailType> = {
  [BackupEmailType.UNKNOWN]: EmailType.HOME,
  [BackupEmailType.HOME]: EmailType.HOME,
  [BackupEmailType.MOBILE]: EmailType.MOBILE,
  [BackupEmailType.WORK]: EmailType.WORK,
  [BackupEmailType.CUSTOM]: EmailType.CUSTOM,
};
const ADDRESS_TYPES: Record<BackupAddressType, AddressType> = {
  [BackupAddressType.UNKNOWN]: AddressType.HOME,
  [BackupAddressType.HOME]: AddressType.HOME,
  [BackupAddressType.WORK]: AddressType.WORK,
  [BackupAddressType.CUSTOM]: AddressType.CUSTOM,
};
const SEND_STATUSES: Record<NonNullable<SendStatus['deliveryStatus']['case']>, RecordSendStatus | undefined> = {
  pending: 'pending',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  viewed: 'viewed',
  failed: 'failed',
  // Recipients we did not send to, such as blocked group members
  skipped: undefined,
};

/**
 * Converts a backup chat item into a message record whose `dataMessage` reads like a received one (Signal Desktop
 * `fromChatItem` in `ts/services/backups/import.preload.ts`). Returns the reason as a string for items that are
 * not stored: unsupported kinds, expired disappearing messages and items without a known chat or author ACI.
 */
export function convertChatItem(item: ChatItem, context: ChatItemContext): ConvertedChatItem | string {
  const conversationId = context.chatConversationIds.get(item.chatId);
  if (!conversationId) return 'chatItemWithoutChat';
  const authorAci = context.recipientAcis.get(item.authorId);
  if (!authorAci) return 'chatItemWithoutAuthorAci';
  const { directionalDetails: direction } = item;
  if (!direction.case) return 'chatItemWithoutDirection';
  if ((direction.case === 'outgoing') !== (authorAci === context.selfAci) && direction.case !== 'directionless') {
    return 'chatItemWithWrongDirection';
  }

  const expireTimer = item.expiresInMs ? Math.round(Number(item.expiresInMs) / MS_PER_SECOND) : undefined;
  const expirationStart = item.expireStartDate ? Number(item.expireStartDate) : undefined;
  const expiresAt = expireTimer && expirationStart !== undefined
    ? expirationStart + expireTimer * MS_PER_SECOND
    : undefined;
  if (expiresAt !== undefined && expiresAt <= context.now) return 'expired';

  // An edited message keeps the timestamp of its first version, which identifies it
  const sentAt = Number(item.revisions[0]?.dateSent ?? item.dateSent);
  const base: NewMessageRecord = {
    conversationId,
    kind: 'message',
    authorAci,
    sentAt,
    receivedAt: sentAt,
    isOutgoing: direction.case === 'outgoing' || authorAci === context.selfAci,
    expireTimer,
    expiresAt,
    readAt: sentAt,
  };
  if (direction.case === 'outgoing') {
    base.receivedAt = Number(direction.value.dateReceived) || sentAt;
    base.recipientStatus = buildRecipientStatus(direction.value.sendStatus, context);
  } else if (direction.case === 'incoming') {
    const { dateReceived, dateServerSent, read, sealedSender } = direction.value;
    base.receivedAt = Number(dateReceived) || sentAt;
    base.serverTimestamp = dateServerSent ? Number(dateServerSent) : undefined;
    base.readAt = read ? base.receivedAt : undefined;
    base.isSealedSender = sealedSender;
  }

  const record = convertItem(item, base, context);
  if (typeof record === 'string') return record;
  return { record, pin: buildPin(item, context) };
}

function convertItem(
  item: ChatItem, base: NewMessageRecord, context: ChatItemContext,
): NewMessageRecord | string {
  const timestamp = item.dateSent;
  const { expireTimer } = base;
  const { item: content } = item;

  switch (content.case) {
    case 'standardMessage': {
      const dataMessage = buildStandardDataMessage(content.value, timestamp, expireTimer, context);
      const revisions = item.revisions.flatMap((revision) => (
        revision.item.case === 'standardMessage' ? [{
          dataMessage: toBinary(DataMessageSchema, buildStandardDataMessage(
            revision.item.value, revision.dateSent, expireTimer, context,
          )),
          editedAt: Number(revision.dateSent),
        }] : []
      ));
      return {
        ...withDataMessage(base, dataMessage),
        reactions: buildReactions(content.value.reactions, context),
        revisions: revisions.length ? revisions : undefined,
        editedAt: revisions.length ? Number(timestamp) : undefined,
      };
    }
    case 'contactMessage':
      return {
        ...withDataMessage(base, {
          timestamp, expireTimer, contact: content.value.contact ? [buildContact(content.value.contact)] : [],
        }),
        reactions: buildReactions(content.value.reactions, context),
      };
    case 'stickerMessage':
      if (!content.value.sticker) return 'stickerMessageWithoutSticker';
      return {
        ...withDataMessage(base, { timestamp, expireTimer, sticker: buildSticker(content.value.sticker) }),
        reactions: buildReactions(content.value.reactions, context),
      };
    case 'viewOnceMessage': {
      const { attachment, reactions } = content.value;
      const pointer = attachment && buildMessageAttachment(attachment);
      // The backup drops the attachment of an opened view-once message
      if (!pointer) return { ...base, isViewOnceOpened: true, viewedAt: base.readAt };
      return {
        ...withDataMessage(base, { timestamp, expireTimer, isViewOnce: true, attachments: [pointer] }),
        reactions: buildReactions(reactions, context),
      };
    }
    case 'poll':
      return {
        ...withDataMessage(base, { timestamp, expireTimer, pollCreate: buildPollCreate(content.value) }),
        pollVotes: buildPollVotes(content.value, context),
        isPollEnded: content.value.hasEnded || undefined,
        reactions: buildReactions(content.value.reactions, context),
      };
    case 'remoteDeletedMessage':
    case 'adminDeletedMessage':
      return { ...base, deletedAt: context.now };
    case 'updateMessage': {
      const { update } = content.value;
      if (update.case === 'expirationTimerChange') {
        return buildTimerNotice(base, Number(update.value.expiresInMs));
      }
      if (update.case === 'groupChange') {
        return convertGroupChange(update.value, base, context);
      }
      return `update:${update.case ?? 'unknown'}`;
    }
    default:
      // Gift badges, payments and story replies
      return content.case ?? 'unknown';
  }
}

function withDataMessage(base: NewMessageRecord, init: DataMessageInit): NewMessageRecord {
  const dataMessage = create(DataMessageSchema, init);
  return { ...base, dataMessage: toBinary(DataMessageSchema, dataMessage), body: dataMessage.body || undefined };
}

/** Only timer changes of group updates are stored, as the timer notices of private chats */
function convertGroupChange(change: GroupChangeChatUpdate, base: NewMessageRecord, context: ChatItemContext) {
  const timerUpdate = change.updates.find(({ update }) => update.case === 'groupExpirationTimerUpdate')?.update;
  if (timerUpdate?.case !== 'groupExpirationTimerUpdate') return 'update:groupChange';
  const { expiresInMs, updaterAci } = timerUpdate.value;
  const actorAci = updaterAci?.length ? uuidToString(updaterAci) : base.authorAci;
  const notice = buildTimerNotice({ ...base, authorAci: actorAci }, Number(expiresInMs));
  return { ...notice, isOutgoing: actorAci === context.selfAci };
}

/** Notices have no author, so that lookups by author and timestamp never find them (see `MessageRecord`) */
function buildTimerNotice(base: NewMessageRecord, expiresInMs: number): NewMessageRecord {
  return {
    conversationId: base.conversationId,
    kind: 'timerUpdate',
    authorAci: '',
    actorAci: base.authorAci,
    sentAt: base.sentAt,
    receivedAt: base.receivedAt,
    isOutgoing: base.isOutgoing,
    expireTimer: Math.round(expiresInMs / MS_PER_SECOND) || undefined,
    readAt: base.sentAt,
  };
}

function buildStandardDataMessage(
  message: StandardMessage, timestamp: bigint, expireTimer: number | undefined, context: ChatItemContext,
) {
  const attachments = message.attachments.map(buildMessageAttachment).filter((pointer) => pointer !== undefined);
  // A long body arrives whole as a text attachment, as in received messages
  if (message.longText) {
    const longText = buildAttachmentPointer(message.longText);
    longText.contentType = LONG_TEXT_CONTENT_TYPE;
    attachments.push(longText);
  }
  return create(DataMessageSchema, {
    timestamp,
    expireTimer,
    body: message.text?.body,
    bodyRanges: buildBodyRanges(message.text?.bodyRanges),
    attachments,
    quote: message.quote && buildQuote(message.quote, context),
    preview: message.linkPreview.map(({
      url, title, description, date, image,
    }) => ({
      url, title, description, date, image: image && buildAttachmentPointer(image),
    })),
  });
}

function buildMessageAttachment({ pointer, flag, clientUuid }: MessageAttachment) {
  if (!pointer) return undefined;
  const attachment = buildAttachmentPointer(pointer);
  attachment.flags = ATTACHMENT_FLAGS[flag] ?? 0;
  if (clientUuid?.length) attachment.clientUuid = clientUuid;
  return attachment;
}

/**
 * The transit tier fields of a file pointer, which the CDN download of received attachments uses (Signal Desktop
 * `convertFilePointerToAttachment` in `ts/services/backups/util/filePointers.preload.ts`). Pointers to the backup
 * media tier only have no location: their download needs backup credentials.
 */
function buildAttachmentPointer(pointer: FilePointer) {
  const locator = pointer.locatorInfo;
  const integrityCheck = locator?.integrityCheck;
  return create(AttachmentPointerSchema, {
    attachmentIdentifier: locator?.transitCdnKey ? { case: 'cdnKey', value: locator.transitCdnKey } : undefined,
    cdnNumber: locator?.transitCdnKey ? locator.transitCdnNumber : undefined,
    uploadTimestamp: locator?.transitTierUploadTimestamp,
    key: locator?.key.length ? locator.key : undefined,
    // Downloaded attachments have the hash of their plaintext instead, which the download does not check
    digest: integrityCheck?.case === 'encryptedDigest' ? integrityCheck.value : undefined,
    size: locator?.size,
    contentType: pointer.contentType,
    fileName: pointer.fileName,
    width: pointer.width,
    height: pointer.height,
    caption: pointer.caption,
    blurHash: pointer.blurHash,
    incrementalMac: pointer.incrementalMac,
    chunkSize: pointer.incrementalMacChunkSize,
    audioWaveform: pointer.audioWaveform,
    audioDurationSeconds: pointer.audioDurationSeconds,
  });
}

function buildBodyRanges(ranges: BackupBodyRange[] = []) {
  return ranges.flatMap(({ start, length, associatedValue }): BodyRange[] => {
    if (associatedValue.case === 'mentionAci') {
      return [create(BodyRangeSchema, {
        start, length, associatedValue: { case: 'mentionAciBinary', value: associatedValue.value },
      })];
    }
    const style = associatedValue.case === 'style' ? BODY_RANGE_STYLES[associatedValue.value] : undefined;
    return style ? [create(BodyRangeSchema, { start, length, associatedValue: { case: 'style', value: style } })] : [];
  });
}

function buildQuote(quote: Quote, context: ChatItemContext) {
  return {
    id: quote.targetSentTimestamp,
    authorAci: context.recipientAcis.get(quote.authorId),
    text: quote.text?.body,
    bodyRanges: buildBodyRanges(quote.text?.bodyRanges),
    attachments: quote.attachments.map(({ contentType, fileName, thumbnail }) => ({
      contentType,
      fileName,
      thumbnail: thumbnail?.pointer && buildAttachmentPointer(thumbnail.pointer),
    })),
    type: quote.type === Quote_Type.GIFT_BADGE ? DataMessage_Quote_Type.GIFT_BADGE
      : quote.type === Quote_Type.POLL ? DataMessage_Quote_Type.POLL
        : DataMessage_Quote_Type.NORMAL,
  };
}

function buildContact(contact: ContactAttachment): NonNullable<DataMessageInit['contact']>[number] {
  const { name, nickname } = contact;
  return {
    name: name && {
      givenName: name.givenName,
      familyName: name.familyName,
      prefix: name.prefix,
      suffix: name.suffix,
      middleName: name.middleName,
      nickname: name.nickname,
    },
    number: contact.number.map(({ value, type, label }) => ({
      value, label, type: PHONE_TYPES[type] ?? PhoneType.HOME,
    })),
    email: contact.email.map(({ value, type, label }) => ({
      value, label, type: EMAIL_TYPES[type] ?? EmailType.HOME,
    })),
    address: contact.address.map(({
      type, label, street, pobox, neighborhood, city, region, postcode, country,
    }) => ({
      type: ADDRESS_TYPES[type] ?? AddressType.HOME,
      label,
      street,
      pobox,
      neighborhood,
      city,
      region,
      postcode,
      country,
    })),
    avatar: contact.avatar && { avatar: buildAttachmentPointer(contact.avatar) },
    organization: contact.organization,
    aciBinary: contact.aci.length ? contact.aci : undefined,
    nickname: nickname && { given: nickname.given, family: nickname.family },
    note: contact.note,
  };
}

function buildSticker({
  packId, packKey, stickerId, emoji, data,
}: Sticker) {
  return {
    packId, packKey, stickerId, emoji, data: data && buildAttachmentPointer(data),
  };
}

function buildPollCreate({ question, allowMultiple, options }: Poll) {
  return { question, allowMultiple, options: options.map(({ option }) => option) };
}

function buildPollVotes({ options }: Poll, context: ChatItemContext): MessageRecord['pollVotes'] {
  const votes = new Map<string, { authorAci: string; optionIndexes: number[]; voteCount: number }>();
  options.forEach((option, index) => {
    for (const { voterId, voteCount } of option.votes) {
      const authorAci = context.recipientAcis.get(voterId);
      if (!authorAci) continue;
      const vote = votes.get(authorAci) ?? { authorAci, optionIndexes: [], voteCount: voteCount || 1 };
      vote.optionIndexes.push(index);
      votes.set(authorAci, vote);
    }
  });
  return votes.size ? [...votes.values()] : undefined;
}

/** Reactions in the order they were added; the backup orders them by `sortOrder` */
function buildReactions(reactions: Reaction[], context: ChatItemContext): MessageRecord['reactions'] {
  const result = [...reactions]
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
    .flatMap(({ emoji, authorId, sentTimestamp }) => {
      const authorAci = context.recipientAcis.get(authorId);
      return authorAci ? [{ emoji, authorAci, sentAt: Number(sentTimestamp) }] : [];
    });
  return result.length ? result : undefined;
}

function buildRecipientStatus(statuses: SendStatus[], context: ChatItemContext) {
  const result: Record<string, RecordSendStatus> = {};
  for (const { recipientId, deliveryStatus } of statuses) {
    const aci = context.recipientAcis.get(recipientId);
    // An unset status means pending
    const status = deliveryStatus.case ? SEND_STATUSES[deliveryStatus.case] : 'pending';
    if (aci && status) result[aci] = status;
  }
  return Object.keys(result).length ? result : undefined;
}

function buildPin({ pinDetails }: ChatItem, context: ChatItemContext): PinnedMessage | undefined {
  if (!pinDetails) return undefined;
  const { pinnedAtTimestamp, pinExpiry } = pinDetails;
  const expiresAt = pinExpiry.case === 'pinExpiresAtTimestamp' ? Number(pinExpiry.value) : undefined;
  if (expiresAt !== undefined && expiresAt <= context.now) return undefined;
  return { pinnedAt: Number(pinnedAtTimestamp), expiresAt };
}
