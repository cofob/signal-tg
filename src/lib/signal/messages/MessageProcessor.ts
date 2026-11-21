import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type MessageDb from '../db/MessageDb';
import type {
  ConversationRecord, MessageRecord, NewMessageRecord, SendStatus,
} from '../db/MessageDb';
import type { GroupState } from '../groups/fetchGroup';
import type { DecryptedGroupChange } from '../groups/groupChange';
import type {
  AddressableMessage,
  AddressableMessageSchema,
  ConversationIdentifier,
  ConversationIdentifierSchema,
  DataMessage,
  EditMessage,
  GroupContextV2,
  ReceiptMessage,
  SyncMessage,
  SyncMessage_DeleteForMe,
  SyncMessage_DeleteForMeSchema,
  SyncMessage_Sent,
  TypingMessage,
} from '../proto/generated/SignalService_pb';
import type { StorageRecord } from '../proto/generated/StorageService_pb';
import type { DecryptedEnvelope } from '../receiver/decryptEnvelope';
import type { RecipientResult, SenderContext } from '../sender/sendContent';
import type { OutgoingMessage } from '../sender/sendMessage';
import type { GroupTarget } from '../sender/sendToGroup';
import type SignalClient from '../SignalClient';
import type { AccountRecord } from '../store/SignalStore';

import { bufferFromBase64, buffersEqual, bufferToBase64 } from '../../../util/encoding/buffer';
import { downloadAttachment } from '../attachments/downloadAttachment';
import { decryptGroupState, fetchGroup } from '../groups/fetchGroup';
import {
  applyGroupChange, decryptGroupChange, getChangeProfileKeys, verifyGroupChange,
} from '../groups/groupChange';
import { fetchGroupLog } from '../groups/groupLog';
import { saveGroupSendEndorsements } from '../groups/groupSendEndorsements';
import { buildGroupNotices } from '../groups/groupUpdates';
import { fetchProfile } from '../profiles/fetchProfile';
import { MAX_SPAM_REPORT_MESSAGES, reportSpam } from '../sender/reportSpam';
import { saveProfileKey } from '../sender/sealedSender';
import {
  sendBlockedSync,
  sendDeleteForMeSync,
  sendMessage,
  sendMessageRequestResponseSync,
  sendReadSync,
  sendReceipts,
  sendTyping,
  sendViewedSync,
  sendViewOnceOpenSync,
} from '../sender/sendMessage';
import { uuidToBytes, uuidToString } from '../serviceId';
import { parseContactSync } from '../sync/contactSync';
import { wasm } from '../wasm';
import { getIsConversationAccepted } from './messageRequests';

import { GroupChange_ActionsSchema, GroupChangeSchema, Member_Role } from '../proto/generated/Groups_pb';
import {
  AttachmentPointerSchema,
  BodyRangeSchema,
  DataMessage_Flags,
  DataMessageSchema,
  GroupContextV2Schema,
  ReceiptMessage_Type,
  SyncMessage_MessageRequestResponse_Type,
  TypingMessage_Action,
} from '../proto/generated/SignalService_pb';

export type MessageChanges = {
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  // Ids of `messages` stored for the first time
  addedMessageIds: number[];
  deletedMessages: { conversationId: string; id: number }[];
};

export type MessageEdit = {
  body: string;
  bodyRanges: MessageInitShape<typeof BodyRangeSchema>[];
  // The full text of a long body, uploaded as a `LONG_TEXT_CONTENT_TYPE` attachment
  bodyAttachment?: MessageInitShape<typeof AttachmentPointerSchema>;
};

export type ConversationPatch = Partial<ConversationRecord> & Pick<ConversationRecord, 'id' | 'type'>;

export type PinnedMessage = Omit<NonNullable<ConversationRecord['pinnedMessages']>[number], 'messageId'>;

/** Transferred message history to store, see `importHistory` */
export type HistoryBatch = {
  conversations: ConversationPatch[];
  messages: { record: NewMessageRecord; pin?: PinnedMessage }[];
};

export type TypingEvent = {
  conversationId: string;
  senderAci: string;
  isTyping: boolean;
};

type MessageReaction = NonNullable<MessageRecord['reactions']>[number];

type MessageProcessorEvents = {
  onChanges(changes: MessageChanges): void;
  onTyping(event: TypingEvent): void;
  onError(error: Error): void;
};

type MessageSource = {
  authorAci: string;
  authorDeviceId?: number;
  sentAt: number;
  serverTimestamp?: number;
  isOutgoing: boolean;
  isSealedSender?: boolean;
  // Sent transcripts: the private conversation and the recipients the message reached
  destinationAci?: string;
  sentTo?: { serviceId: string; isSealedSender: boolean }[];
  expirationStartTimestamp?: number;
  serverGuid?: string;
};

type MessageRequestResponseType = SyncMessage_MessageRequestResponse_Type;

const DELIVERY_RECEIPT_DELAY_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Signal Desktop `ts/util/canEditMessage.dom.ts` and `ts/util/getDeleteMaxAgeMs.std.ts`
const EDIT_MAX_AGE_MS = DAY_MS;
const MAX_EDIT_COUNT = 10;
const DELETE_FOR_EVERYONE_MAX_AGE_MS = DAY_MS;
export const LONG_TEXT_CONTENT_TYPE = 'text/x-signal-plain';
const ACI_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const UUID_BYTE_LENGTH = 16;
const STATUS_RANK: Record<SendStatus, number> = {
  failed: 0, pending: 1, sent: 2, delivered: 3, read: 4, viewed: 5,
};
// Signal Desktop `ts/models/conversations.preload.ts` (`destroyMessages`): a conversation delete names this many of
// its latest messages, so other devices find where it ended
const CONVERSATION_DELETE_MESSAGE_COUNT = 5;
const BLOCK_RESPONSES = new Set<MessageRequestResponseType>([
  SyncMessage_MessageRequestResponse_Type.BLOCK,
  SyncMessage_MessageRequestResponse_Type.BLOCK_AND_DELETE,
  SyncMessage_MessageRequestResponse_Type.BLOCK_AND_SPAM,
]);
const DELETE_RESPONSES = new Set<MessageRequestResponseType>([
  SyncMessage_MessageRequestResponse_Type.DELETE,
  SyncMessage_MessageRequestResponse_Type.BLOCK_AND_DELETE,
]);
const SPAM_RESPONSES = new Set<MessageRequestResponseType>([
  SyncMessage_MessageRequestResponse_Type.SPAM,
  SyncMessage_MessageRequestResponse_Type.BLOCK_AND_SPAM,
]);
const STATUS_BY_RECEIPT_TYPE: Record<ReceiptMessage_Type, SendStatus> = {
  [ReceiptMessage_Type.DELIVERY]: 'delivered',
  [ReceiptMessage_Type.READ]: 'read',
  [ReceiptMessage_Type.VIEWED]: 'viewed',
};

/**
 * Turns decrypted content into conversations and messages in `MessageDb` (Signal Desktop
 * `ts/textsecure/MessageReceiver.preload.ts` and the handlers in `ts/background.preload.ts`), and sends
 * what the protocol expects in return: delivery receipts, read receipts and read syncs.
 * All database changes run one at a time and are reported through `onChanges`.
 */
export default class MessageProcessor {
  private serial = Promise.resolve();

  private changes = createChanges();

  private deliveryReceipts = new Map<string, number[]>();

  private deliveryReceiptTimer?: ReturnType<typeof setTimeout>;

  private expirationTimer?: ReturnType<typeof setTimeout>;

  private groupRefreshes = new Map<string, Promise<ConversationRecord | undefined>>();

  // Profiles of new conversations are fetched one at a time to stay within the server's rate limit
  private profileQueue = Promise.resolve();

  private lastTimestamp = 0;

  // Receipts and syncs for local changes made without a connection, sent after the next one
  private pendingSends: ((context: SenderContext) => Promise<void>)[] = [];

  constructor(
    private db: MessageDb,
    private client: SignalClient,
    private events: MessageProcessorEvents,
  ) {}

  /** Handles one decrypted envelope; `SignalClient.connect` passes it as `onContent` */
  processContent(decrypted: DecryptedEnvelope) {
    return this.runSerial(() => this.handleContent(decrypted));
  }

  /** Starts the disappearing messages timer for messages stored earlier */
  start() {
    void this.runSerial(() => this.deleteExpiredMessages());
    void this.flushPendingSends();
  }

  stop() {
    clearTimeout(this.expirationTimer);
    clearTimeout(this.deliveryReceiptTimer);
  }

  /**
   * Stores and sends a message from this device. The message is stored as pending first, then each
   * recipient's status follows the send; without a connection every recipient fails. `onStored` runs
   * before the stored message is reported through `onChanges`.
   */
  async sendDataMessage(
    conversationId: string,
    init: MessageInitShape<typeof DataMessageSchema>,
    onStored?: (message: MessageRecord) => void,
  ) {
    const account = await this.getAccount();
    const sentAt = this.allocateTimestamp();

    const { conversation, message, dataMessage } = await this.runSerial(async () => {
      // An ACI that has no conversation yet starts one
      const found = await this.db.getConversation(conversationId)
        ?? (ACI_PATTERN.test(conversationId) ? await this.ensurePrivateConversation(conversationId) : undefined);
      if (!found) throw new Error(`Unknown conversation ${conversationId}`);
      // Writing accepts the message request, so the message carries our profile key
      const accepted = found.isAccepted ? found : await this.putConversation({ ...found, isAccepted: true });
      const outgoing = createOutgoingDataMessage(account, accepted, init, sentAt);
      const { message: added } = await this.addMessage(accepted, {
        conversationId,
        kind: 'message',
        authorAci: account.aci,
        authorDeviceId: account.deviceId,
        sentAt,
        receivedAt: sentAt,
        isOutgoing: true,
        dataMessage: toBinary(DataMessageSchema, outgoing),
        body: outgoing.body || undefined,
        expireTimer: accepted.expireTimer || undefined,
        expiresAt: accepted.expireTimer ? sentAt + accepted.expireTimer * 1000 : undefined,
        readAt: sentAt,
        recipientStatus: buildPendingStatus(getRecipientAcis(accepted, account.aci)),
      });
      onStored?.(added);
      return { conversation: accepted, message: added, dataMessage: outgoing };
    });

    return this.sendStoredMessage(conversation, message, { case: 'dataMessage', value: dataMessage }, {
      timestamp: sentAt,
      expirationStartTimestamp: conversation.expireTimer ? sentAt : undefined,
    });
  }

  /**
   * Edits the text of an outgoing message (Signal Desktop `ts/util/sendEditedMessage.preload.ts`): the earlier
   * version goes to `revisions` and the edit is sent with the original timestamp as its target. Messages older
   * than a day and messages edited `MAX_EDIT_COUNT` times stay as they are, except in Note to Self.
   */
  async sendEditMessage(messageId: number, edit: MessageEdit) {
    const account = await this.getAccount();
    const editedAt = this.allocateTimestamp();

    const { conversation, message, editMessage } = await this.runSerial(async () => {
      const target = await this.db.getMessage(messageId);
      const found = target && await this.db.getConversation(target.conversationId);
      if (!target?.dataMessage || !found || target.authorAci !== account.aci || target.deletedAt) {
        throw new Error('The message cannot be edited');
      }
      const isNoteToSelf = found.id === account.aci;
      const isTooOld = editedAt - target.sentAt > EDIT_MAX_AGE_MS;
      if (!isNoteToSelf && (isTooOld || (target.revisions?.length ?? 0) >= MAX_EDIT_COUNT)) {
        throw new Error('The message can no longer be edited');
      }

      const edited = fromBinary(DataMessageSchema, target.dataMessage);
      edited.body = edit.body;
      edited.bodyRanges = edit.bodyRanges.map((range) => create(BodyRangeSchema, range));
      edited.attachments = edited.attachments.filter(({ contentType }) => contentType !== LONG_TEXT_CONTENT_TYPE);
      if (edit.bodyAttachment) edited.attachments.push(create(AttachmentPointerSchema, edit.bodyAttachment));
      setOutgoingFields(edited, account, found, editedAt);
      const updated = await this.putMessage({
        ...target,
        revisions: [...target.revisions ?? [], {
          dataMessage: target.dataMessage, editedAt: target.editedAt ?? target.sentAt,
        }],
        dataMessage: toBinary(DataMessageSchema, edited),
        body: edited.body || undefined,
        editedAt,
        // Like Signal Desktop, the message shows the send state of its latest edit
        recipientStatus: buildPendingStatus(getRecipientAcis(found, account.aci)),
      });
      return {
        conversation: found,
        message: updated,
        editMessage: { targetSentTimestamp: BigInt(target.sentAt), dataMessage: edited },
      };
    });

    return this.sendStoredMessage(conversation, message, { case: 'editMessage', value: editMessage }, {
      timestamp: editedAt,
    });
  }

  /**
   * Sets our reaction to a message, or removes it when `emoji` is absent; Signal keeps one reaction per person.
   * The reaction is shown at once and taken back when no recipient gets it.
   */
  async sendReaction(messageId: number, emoji?: string) {
    const account = await this.getAccount();
    const sentAt = this.allocateTimestamp();

    const prepared = await this.runSerial(async () => {
      const target = await this.db.getMessage(messageId);
      const found = target && await this.db.getConversation(target.conversationId);
      if (!target || !found || target.kind !== 'message' || !target.dataMessage) {
        throw new Error('The message cannot have reactions');
      }
      const previous = target.reactions?.find(({ authorAci }) => authorAci === account.aci);
      if (!emoji && !previous) return undefined;
      await this.putReaction(target, account.aci, emoji ? { emoji, authorAci: account.aci, sentAt } : undefined);
      return { conversation: found, target, previous };
    });
    if (!prepared) return;

    const { conversation, target, previous } = prepared;
    const isSent = await this.sendToConversation(conversation, {
      reaction: {
        emoji: emoji ?? previous!.emoji,
        remove: !emoji,
        targetAuthorAci: target.authorAci,
        targetSentTimestamp: BigInt(target.sentAt),
      },
    }, sentAt);
    if (!isSent) {
      await this.runSerial(async () => {
        const current = await this.db.getMessage(target.id);
        if (current) await this.putReaction(current, account.aci, previous);
      });
      throw new Error('The reaction was not sent');
    }
  }

  /**
   * Deletes messages for everyone (Signal Desktop `ts/util/canDeleteForEveryone.preload.ts`): our own messages
   * through `delete`, other members' group messages through `adminDelete` when we are an admin, each within
   * a day of sending. Nothing is deleted when any message does not qualify.
   */
  async deleteForEveryone(messageIds: number[]) {
    const account = await this.getAccount();
    const now = Date.now();

    const targets = await this.runSerial(async () => {
      const found: { message: MessageRecord; conversation: ConversationRecord; isAdminDelete: boolean }[] = [];
      for (const id of messageIds) {
        const message = await this.db.getMessage(id);
        const conversation = message && await this.db.getConversation(message.conversationId);
        if (!message || !conversation || message.kind !== 'message' || message.deletedAt) {
          throw new Error('The message cannot be deleted for everyone');
        }
        const isOwn = message.authorAci === account.aci;
        const isAdminDelete = !isOwn && conversation.type === 'group'
          && Boolean(conversation.adminAcis?.includes(account.aci));
        const age = now - (message.serverTimestamp ?? message.sentAt);
        if ((!isOwn && !isAdminDelete) || conversation.id === account.aci || age > DELETE_FOR_EVERYONE_MAX_AGE_MS) {
          throw new Error('The message cannot be deleted for everyone');
        }
        found.push({ message, conversation, isAdminDelete });
      }
      for (const { message, isAdminDelete } of found) {
        await this.applyDelete(message.authorAci, message.sentAt, isAdminDelete ? account.aci : undefined);
      }
      return found;
    });

    for (const { message, conversation, isAdminDelete } of targets) {
      const targetSentTimestamp = BigInt(message.sentAt);
      await this.sendToConversation(conversation, isAdminDelete ? {
        adminDelete: { targetAuthorAciBinary: uuidToBytes(message.authorAci), targetSentTimestamp },
      } : {
        delete: { targetSentTimestamp },
      }, this.allocateTimestamp(), false);
    }
  }

  /** Deletes messages on this device and tells our other devices (Signal Desktop `ts/util/deleteForMe.preload.ts`) */
  async deleteForMe(messageIds: number[]) {
    const deletes = await this.runSerial(async () => {
      const deletedByConversationId = new Map<string, MessageRecord[]>();
      for (const id of messageIds) {
        const message = await this.db.getMessage(id);
        if (!message) continue;
        await this.removeMessage(message);
        const { conversationId } = message;
        deletedByConversationId.set(conversationId, [...deletedByConversationId.get(conversationId) ?? [], message]);
      }

      const result: { conversation: ConversationRecord; messages: MessageRecord[] }[] = [];
      for (const [conversationId, messages] of deletedByConversationId) {
        const conversation = await this.updateLastMessage(conversationId);
        const addressable = messages.filter(isAddressableMessage);
        if (conversation && addressable.length) result.push({ conversation, messages: addressable });
      }
      return result;
    });
    if (!deletes.length) return;

    await this.syncDeleteForMe({
      messageDeletes: deletes.map(({ conversation, messages }) => ({
        conversation: buildConversationIdentifier(conversation),
        messages: messages.map(buildAddressableMessage),
      })),
    });
  }

  /**
   * Deletes every message of a conversation here and on our other devices, which find the end of the
   * conversation by its latest messages (`destroyMessages` in Signal Desktop `ts/models/conversations.preload.ts`).
   * A conversation without such messages goes as a local-only delete.
   */
  async deleteConversation(conversationId: string) {
    const deleted = await this.runSerial(async () => {
      const conversation = await this.db.getConversation(conversationId);
      if (!conversation) return undefined;
      const latest = await this.db.findLatestMessages(
        conversationId, CONVERSATION_DELETE_MESSAGE_COUNT, isAddressableMessage,
      );
      const latestNonExpiring = latest.some(({ expireTimer }) => expireTimer)
        ? await this.db.findLatestMessages(
          conversationId,
          CONVERSATION_DELETE_MESSAGE_COUNT,
          (message) => isAddressableMessage(message) && !message.expireTimer,
        )
        : undefined;
      await this.deleteMessagesUpTo(conversationId);
      await this.updateLastMessage(conversationId);
      return { conversation, latest, latestNonExpiring };
    });
    if (!deleted) return;

    const { conversation, latest, latestNonExpiring } = deleted;
    const identifier = buildConversationIdentifier(conversation);
    await this.syncDeleteForMe(latest.length ? {
      conversationDeletes: [{
        conversation: identifier,
        mostRecentMessages: latest.map(buildAddressableMessage),
        mostRecentNonExpiringMessages: latestNonExpiring?.map(buildAddressableMessage),
        isFullDelete: true,
      }],
    } : {
      localOnlyConversationDeletes: [{ conversation: identifier }],
    });
  }

  /**
   * Answers a message request here and on our other devices (`syncMessageRequestResponse` and
   * `applyMessageRequestResponse` in Signal Desktop `ts/models/conversations.preload.ts`). Accepting shares our
   * profile key with the contact; a spam report names the contact's latest messages. A changed block also sends
   * the blocked list, since this device does not write the storage service yet.
   */
  async respondToMessageRequest(conversationId: string, type: MessageRequestResponseType) {
    const account = await this.getAccount();
    const { previous, conversation, spamServerGuids } = await this.runSerial(async () => {
      const found = await this.db.getConversation(conversationId);
      if (!found || found.id === account.aci) throw new Error('The conversation has no message request');
      // A delete removes the messages that the report names, so they are collected first
      const reported = SPAM_RESPONSES.has(type) && found.type === 'private'
        ? await this.db.findLatestMessages(found.id, MAX_SPAM_REPORT_MESSAGES, (message) => (
          !message.isOutgoing && message.authorAci === found.id && Boolean(message.serverGuid)
        ))
        : [];
      return {
        previous: found,
        conversation: await this.applyMessageRequestResponse(found, type),
        spamServerGuids: reported.map(({ serverGuid }) => serverGuid!),
      };
    });

    const isGroup = conversation.type === 'group';
    await this.sendWhenConnected(async (context) => {
      await sendMessageRequestResponseSync(context, {
        type,
        threadAci: isGroup ? undefined : conversation.id,
        groupId: isGroup ? bufferFromBase64(conversation.id) : undefined,
      });
      if (Boolean(previous.isBlocked) !== Boolean(conversation.isBlocked)) await this.sendBlockedList(context);
      if (spamServerGuids.length) {
        await reportSpam(context.connection, conversation.id, spamServerGuids, conversation.reportingToken);
      }
      if (type === SyncMessage_MessageRequestResponse_Type.ACCEPT && !isGroup) {
        await this.sendToConversation(conversation, {
          flags: DataMessage_Flags.PROFILE_KEY_UPDATE,
        }, this.allocateTimestamp(), false);
      }
    });
  }

  /** Unblocks a conversation without accepting its message request, and sends the blocked list */
  async unblock(conversationId: string) {
    const isChanged = await this.runSerial(async () => {
      const conversation = await this.db.getConversation(conversationId);
      if (!conversation?.isBlocked) return false;
      await this.putConversation({ ...conversation, isBlocked: false });
      const blockedE164s = await this.client.store.getItem('blockedE164s');
      if (conversation.e164 && blockedE164s?.includes(conversation.e164)) {
        await this.client.store.setItem('blockedE164s', blockedE164s.filter((e164) => e164 !== conversation.e164));
      }
      return true;
    });
    if (isChanged) await this.sendWhenConnected((context) => this.sendBlockedList(context));
  }

  /** Votes in a poll; an empty `optionIndexes` takes the vote back */
  async sendPollVote(messageId: number, optionIndexes: number[]) {
    const account = await this.getAccount();
    const sentAt = this.allocateTimestamp();

    const { conversation, target, voteCount } = await this.runSerial(async () => {
      const message = await this.db.getMessage(messageId);
      const found = message && await this.db.getConversation(message.conversationId);
      if (!message || !found || message.isPollEnded) throw new Error('The poll does not accept votes');
      const count = (message.pollVotes?.find(({ authorAci }) => authorAci === account.aci)?.voteCount ?? 0) + 1;
      await this.putMessage({
        ...message,
        pollVotes: [
          ...(message.pollVotes ?? []).filter(({ authorAci }) => authorAci !== account.aci),
          { authorAci: account.aci, optionIndexes, voteCount: count },
        ],
      });
      return { conversation: found, target: message, voteCount: count };
    });

    await this.sendToConversation(conversation, {
      pollVote: {
        targetAuthorAciBinary: uuidToBytes(target.authorAci),
        targetSentTimestamp: BigInt(target.sentAt),
        optionIndexes,
        voteCount,
      },
    }, sentAt);
  }

  /**
   * Remembers that the CDN no longer has an attachment, an index in `DataMessage.attachments` or the sticker,
   * so it is not downloaded again
   */
  async markAttachmentUnavailable(messageId: number, attachment: number | 'sticker') {
    await this.runSerial(async () => {
      const message = await this.db.getMessage(messageId);
      if (!message) return;
      if (attachment === 'sticker') {
        if (!message.isStickerUnavailable) await this.putMessage({ ...message, isStickerUnavailable: true });
        return;
      }
      if (message.unavailableAttachmentIndexes?.includes(attachment)) return;
      await this.putMessage({
        ...message, unavailableAttachmentIndexes: [...message.unavailableAttachmentIndexes ?? [], attachment],
      });
    });
  }

  /** Ends our own poll */
  async endPoll(messageId: number) {
    const account = await this.getAccount();
    const sentAt = this.allocateTimestamp();

    const { conversation, target } = await this.runSerial(async () => {
      const message = await this.db.getMessage(messageId);
      const found = message && await this.db.getConversation(message.conversationId);
      if (!message || !found || message.authorAci !== account.aci) throw new Error('Only the author ends a poll');
      await this.putMessage({ ...message, isPollEnded: true });
      return { conversation: found, target: message };
    });

    await this.sendToConversation(conversation, {
      pollTerminate: { targetSentTimestamp: BigInt(target.sentAt) },
    }, sentAt);
  }

  /**
   * Marks incoming voice, video and view-once messages viewed, erases opened view-once messages
   * (`markViewOnceMessageViewed` in Signal Desktop `ts/services/MessageUpdater.preload.ts`), and sends
   * viewed receipts (when enabled) and syncs
   */
  async markViewed(messageIds: number[]) {
    const viewedAt = Date.now();
    const viewed = await this.runSerial(async () => {
      const result: { message: MessageRecord; conversation: ConversationRecord; isViewOnce: boolean }[] = [];
      for (const id of messageIds) {
        const message = await this.db.getMessage(id);
        const conversation = message && await this.db.getConversation(message.conversationId);
        if (!message?.dataMessage || !conversation || message.isOutgoing || message.viewedAt) continue;
        const { isViewOnce } = fromBinary(DataMessageSchema, message.dataMessage);
        await this.putMessage({
          ...message,
          viewedAt,
          isViewOnceOpened: isViewOnce || undefined,
          dataMessage: isViewOnce ? undefined : message.dataMessage,
        });
        result.push({ message, conversation, isViewOnce });
      }
      return result;
    });
    if (!viewed.length) return;

    await this.sendWhenConnected(async (context) => {
      if (context.account.isReadReceiptsEnabled) {
        const receipted = viewed
          .filter(({ conversation }) => getIsConversationAccepted(conversation, context.account.aci))
          .map(({ message }) => message);
        for (const [authorAci, timestamps] of groupTimestampsByAuthor(receipted)) {
          await sendReceipts(context, authorAci, ReceiptMessage_Type.VIEWED, timestamps);
        }
      }
      const views = viewed.map(({ message }) => ({ senderAci: message.authorAci, timestamp: message.sentAt }));
      await sendViewedSync(context, views);
      for (const [index, { isViewOnce }] of viewed.entries()) {
        if (isViewOnce) await sendViewOnceOpenSync(context, views[index]);
      }
    });
  }

  /**
   * Sends a typing indicator to a conversation; it reaches only devices online now. Signal sends none while
   * typing indicators are turned off, and none to message requests.
   */
  async sendTyping(conversationId: string, isTyping: boolean) {
    const conversation = await this.db.getConversation(conversationId);
    const context = this.client.getSenderContext();
    if (!conversation || context.account.isTypingIndicatorsEnabled === false
      || !getIsConversationAccepted(conversation, context.account.aci)) {
      return;
    }
    const recipients = getRecipientAcis(conversation, context.account.aci);
    await sendTyping(context, recipients, isTyping, this.getGroupTarget(conversation));
  }

  /**
   * Marks incoming messages of a conversation read up to `maxId`, starts their disappearing timers, and
   * sends read receipts (when enabled) and a read sync
   */
  async markRead(conversationId: string, maxId?: number) {
    const readAt = Date.now();
    const { conversation, messages } = await this.runSerial(async () => {
      const found = await this.db.getConversation(conversationId);
      if (!found) return { conversation: undefined, messages: [] };
      const unread = await this.db.getUnreadMessages(conversationId, maxId);
      for (const message of unread) {
        await this.putMessage({
          ...message,
          readAt,
          expiresAt: message.expireTimer ? readAt + message.expireTimer * 1000 : undefined,
        });
      }
      const remaining = maxId !== undefined ? (await this.db.getUnreadMessages(conversationId)).length : 0;
      await this.putConversation({ ...found, unreadCount: remaining, isMarkedUnread: false });
      this.scheduleExpiration();
      return { conversation: found, messages: unread };
    });
    this.flush();
    if (!conversation || !messages.length) return;

    await this.sendWhenConnected(async (context) => {
      if (context.account.isReadReceiptsEnabled && getIsConversationAccepted(conversation, context.account.aci)) {
        for (const [authorAci, timestamps] of groupTimestampsByAuthor(messages)) {
          await sendReceipts(context, authorAci, ReceiptMessage_Type.READ, timestamps);
        }
      }
      const reads = messages.map(({ authorAci, sentAt }) => ({ senderAci: authorAci, timestamp: sentAt }));
      await sendReadSync(context, reads);
    });
  }

  /**
   * Merges storage service records: contacts and groups with their archive, mute, block and
   * message request state, the order of pinned conversations and account settings
   */
  async applyStorageRecords(records: StorageRecord[]) {
    const { store, account } = this.client.getSenderContext();
    // Pins come only from the account record
    let pinIndexById: Map<string, number> | undefined;

    await this.runSerial(async () => {
      const blockedE164s = new Set(await store.getItem('blockedE164s'));
      const blockedE164Count = blockedE164s.size;
      for (const { record } of records) {
        if (record.case === 'contact') {
          const contact = record.value;
          const aci = contact.aci || (contact.aciBinary.length ? uuidToString(contact.aciBinary) : undefined);
          // Numbers without an ACI have no conversation, but their block goes into the blocked list we sync
          if (!aci && contact.blocked && contact.e164) blockedE164s.add(contact.e164);
          if (!aci || aci === account.aci) continue;
          if (contact.profileKey.length) await saveProfileKey(store, aci, contact.profileKey);

          const conversation = await this.ensurePrivateConversation(aci);
          await this.putConversation({
            ...conversation,
            e164: contact.e164 || conversation.e164,
            profileName: contact.givenName || conversation.profileName,
            profileFamilyName: contact.familyName || conversation.profileFamilyName,
            systemName: [contact.systemGivenName, contact.systemFamilyName].filter(Boolean).join(' ') || undefined,
            nickname: [contact.nickname?.given, contact.nickname?.family].filter(Boolean).join(' ') || undefined,
            username: contact.username || undefined,
            isArchived: contact.archived,
            isMarkedUnread: contact.markedUnread,
            isBlocked: contact.blocked,
            isAccepted: contact.whitelisted || conversation.isAccepted,
            mutedUntil: Number(contact.mutedUntilTimestamp) || undefined,
          });
        } else if (record.case === 'groupV2' && record.value.masterKey.length) {
          const group = record.value;
          const conversation = await this.getOrCreateGroupConversation(group.masterKey, 0);
          await this.putConversation({
            ...conversation,
            isArchived: group.archived,
            isMarkedUnread: group.markedUnread,
            isBlocked: group.blocked,
            isAccepted: group.whitelisted || conversation.isAccepted,
            mutedUntil: Number(group.mutedUntilTimestamp) || undefined,
          });
        } else if (record.case === 'account') {
          const accountRecord = record.value;
          pinIndexById = new Map();
          accountRecord.pinnedConversations.forEach(({ identifier }, index) => {
            if (identifier.case === 'contact') {
              const { serviceId, serviceIdBinary } = identifier.value;
              pinIndexById!.set(serviceId || uuidToString(serviceIdBinary), index);
            } else if (identifier.case === 'groupMasterKey') {
              pinIndexById!.set(getGroupId(identifier.value), index);
            }
          });
          await this.client.updateAccount({
            isReadReceiptsEnabled: accountRecord.readReceipts,
            isTypingIndicatorsEnabled: accountRecord.typingIndicators,
            isLinkPreviewsEnabled: accountRecord.linkPreviews,
          });
        }
      }

      if (blockedE164s.size !== blockedE164Count) await store.setItem('blockedE164s', [...blockedE164s]);

      if (!pinIndexById) return;
      for (const conversation of await this.db.getConversations()) {
        const pinIndex = pinIndexById.get(conversation.id);
        if (conversation.pinIndex !== pinIndex) await this.putConversation({ ...conversation, pinIndex });
      }
    });
  }

  /** Changes how this device lists a conversation; other devices learn it only through the storage service */
  updateConversationState(
    id: string, update: Partial<Pick<ConversationRecord, 'isArchived' | 'isMarkedUnread' | 'mutedUntil' | 'pinIndex'>>,
  ) {
    return this.runSerial(async () => {
      const conversation = await this.db.getConversation(id);
      return conversation && this.putConversation({ ...conversation, ...update });
    });
  }

  /**
   * Fetches the profile behind a private conversation and stores its decrypted fields. Our own profile key
   * is in the account, other profile keys are in their recipients.
   */
  async refreshProfile(aci: string) {
    const { store, connection, account } = this.client.getSenderContext();
    const profileKey = aci === account.aci ? account.profileKey : (await store.getRecipient(aci))?.profileKey;
    if (!profileKey) return;

    const profile = await fetchProfile(connection, aci, profileKey);
    if (profile.hasUnrestrictedUnidentifiedAccess) {
      await store.updateRecipient(aci, { sealedSender: 'unrestricted' });
    }
    await this.runSerial(async () => {
      const conversation = await this.ensurePrivateConversation(aci);
      await this.putConversation({
        ...conversation,
        profileName: profile.givenName,
        profileFamilyName: profile.familyName,
        about: profile.about,
        aboutEmoji: profile.aboutEmoji,
        avatarPath: profile.avatarPath,
      });
    });
    this.flush();
  }

  /**
   * Stores transferred message history (`backups/importBackup.ts`): the conversation fields first, creating absent
   * conversations, then the messages in order. A message whose author and timestamp are stored already is skipped,
   * so an interrupted import can run again. Nothing goes to `onChanges`: the import ends before the app lists chats,
   * and the app loads them from the database. Returns the number of stored messages.
   */
  importHistory({ conversations, messages }: HistoryBatch) {
    return this.runSerial(async () => {
      const updated = new Map<string, ConversationRecord>();
      let nextLocalId: number | undefined;
      const getConversation = async (id: string) => updated.get(id) ?? this.db.getConversation(id);

      for (const patch of conversations) {
        const existing = await getConversation(patch.id);
        if (!existing) nextLocalId ??= await this.db.allocateLocalId();
        updated.set(patch.id, {
          ...existing ?? { localId: nextLocalId!++, unreadCount: 0 },
          ...patch,
        });
      }

      const added = await this.db.addMessagesIfAbsent(messages.map(({ record }) => record));
      for (const [index, message] of added.entries()) {
        if (!message) continue;
        const conversation = await getConversation(message.conversationId);
        if (!conversation) throw new Error(`Imported message of unknown conversation ${message.conversationId}`);
        const { pin } = messages[index];
        const isUnread = !message.isOutgoing && !message.readAt && message.kind === 'message';
        updated.set(conversation.id, {
          ...conversation,
          lastMessageId: message.id,
          lastMessageAt: message.sentAt,
          unreadCount: conversation.unreadCount + (isUnread ? 1 : 0),
          pinnedMessages: pin
            ? [...conversation.pinnedMessages ?? [], { ...pin, messageId: message.id }]
            : conversation.pinnedMessages,
        });
      }

      await this.db.putConversations([...updated.values()]);
      if (added.some((message) => message?.expiresAt)) this.scheduleExpiration();
      return added.filter(Boolean).length;
    });
  }

  /**
   * Sends receipts or syncs for a local change now, or after the next connection while there is none.
   * A send that fails because the connection closed meanwhile waits for the next one as well.
   */
  private async sendWhenConnected(send: (context: SenderContext) => Promise<void>) {
    if (!this.client.isConnected) {
      this.pendingSends.push(send);
      return;
    }
    try {
      await send(this.client.getSenderContext());
    } catch (err) {
      if (this.client.isConnected) throw err;
      this.pendingSends.push(send);
    }
  }

  private async flushPendingSends() {
    for (const send of this.pendingSends.splice(0)) {
      await this.sendWhenConnected(send).catch(this.events.onError);
    }
  }

  /** The account of this device; it is stored at linking, so local records work without a connection */
  private async getAccount() {
    const account = await this.client.store.getItem('account');
    if (!account) throw new Error('This browser is not linked to a Signal account');
    return account;
  }

  /** Our ACI and a timestamp identify each message we send, so every send takes a new timestamp */
  private allocateTimestamp() {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return this.lastTimestamp;
  }

  /** Sends the content of a stored outgoing message and records each recipient's status */
  private async sendStoredMessage(
    conversation: ConversationRecord,
    message: MessageRecord,
    content: OutgoingMessage,
    options: { timestamp: number; expirationStartTimestamp?: number },
  ) {
    const recipients = Object.keys(message.recipientStatus ?? {});
    const results = await this.sendContentTo(conversation, recipients, content, options);
    return this.runSerial(async () => {
      const current = await this.db.getMessage(message.id);
      if (!current) return message;
      const recipientStatus = { ...current.recipientStatus };
      for (const serviceId of recipients) {
        recipientStatus[serviceId] = getResultError(results, serviceId)
          ? 'failed'
          : maxStatus(recipientStatus[serviceId], 'sent');
      }
      return this.putMessage({ ...current, recipientStatus });
    });
  }

  /**
   * Sends a data message that has no record of its own, such as a reaction or a delete, to the members of
   * a conversation; returns whether it reached any of them
   */
  private async sendToConversation(
    conversation: ConversationRecord,
    init: MessageInitShape<typeof DataMessageSchema>,
    timestamp: number,
    shouldIncludeTimer = true,
  ) {
    const account = await this.getAccount();
    const recipients = getRecipientAcis(conversation, account.aci);
    const dataMessage = createOutgoingDataMessage(account, conversation, init, timestamp, shouldIncludeTimer);
    const results = await this.sendContentTo(conversation, recipients, { case: 'dataMessage', value: dataMessage }, {
      timestamp,
    });
    return !recipients.length || recipients.some((serviceId) => !getResultError(results, serviceId));
  }

  /** Without a connection, or when the send fails as a whole, every recipient fails */
  private async sendContentTo(
    conversation: ConversationRecord,
    recipients: string[],
    content: OutgoingMessage,
    options: { timestamp: number; expirationStartTimestamp?: number },
  ): Promise<RecipientResult[]> {
    try {
      return await sendMessage(this.client.getSenderContext(), recipients, content, {
        ...options,
        group: this.getGroupTarget(conversation),
      });
    } catch (err) {
      this.events.onError(err as Error);
      return recipients.map((serviceId) => ({ serviceId, error: err as Error }));
    }
  }

  /** Group sends renew the send endorsements of the group through its state */
  private getGroupTarget(conversation: ConversationRecord): GroupTarget | undefined {
    if (conversation.type !== 'group' || !conversation.masterKey) return undefined;
    const { id, masterKey } = conversation;
    return {
      id: bufferFromBase64(id),
      secretParams: wasm.GroupSecretParams_DeriveFromMasterKey(masterKey),
      refresh: async () => {
        await this.refreshGroup(id, masterKey);
      },
    };
  }

  private async handleContent(decrypted: DecryptedEnvelope) {
    const { senderServiceId, senderDeviceId, envelope, isSealedSender } = decrypted;
    const body = decrypted.content.content;
    const selfAci = this.client.getSenderContext().account.aci;
    const source: MessageSource = {
      authorAci: senderServiceId,
      authorDeviceId: senderDeviceId,
      sentAt: Number(envelope.clientTimestamp),
      serverTimestamp: Number(envelope.serverTimestamp) || undefined,
      isOutgoing: false,
      isSealedSender,
      serverGuid: envelope.serverGuid
        || (envelope.serverGuidBinary.length ? uuidToString(envelope.serverGuidBinary) : undefined),
    };

    if (senderServiceId !== selfAci) {
      const sender = await this.db.getConversation(senderServiceId);
      // Signal Desktop `ts/textsecure/MessageReceiver.preload.ts` drops everything from blocked senders
      if (sender?.isBlocked) return;
      // Signal Desktop `onEnvelopeUnsealed` in `ts/background.preload.ts`: the latest token goes with spam reports
      const token = envelope.reportSpamToken;
      if (token.length && !(sender?.reportingToken && buffersEqual(sender.reportingToken, token))) {
        const conversation = sender ?? await this.ensurePrivateConversation(senderServiceId);
        await this.putConversation({ ...conversation, reportingToken: token });
      }
    }

    switch (body.case) {
      case 'dataMessage': {
        const sentAt = Number(body.value.timestamp) || source.sentAt;
        await this.handleDataMessage({ ...source, sentAt }, body.value);
        this.queueDeliveryReceipt(senderServiceId, sentAt);
        break;
      }
      case 'editMessage':
        await this.handleEditMessage(source, body.value);
        this.queueDeliveryReceipt(senderServiceId, source.sentAt);
        break;
      case 'syncMessage':
        if (senderServiceId === selfAci) {
          await this.handleSyncMessage(source, body.value);
        }
        break;
      case 'receiptMessage':
        await this.handleReceipt(senderServiceId, body.value);
        break;
      case 'typingMessage':
        await this.handleTyping(senderServiceId, body.value);
        break;
      default:
        // Stories and calls are not supported yet
        break;
    }
  }

  private async handleDataMessage(source: MessageSource, message: DataMessage) {
    const conversation = await this.getConversationForMessage(source, message);
    if (!conversation) return;
    if (!source.isOutgoing && conversation.isBlocked) return;

    if (message.reaction) {
      await this.applyReaction(source, message.reaction);
      return;
    }
    if (message.delete) {
      await this.applyDelete(source.authorAci, Number(message.delete.targetSentTimestamp));
      return;
    }
    if (message.adminDelete) {
      const isAdmin = conversation.adminAcis?.includes(source.authorAci);
      if (isAdmin) {
        await this.applyDelete(
          uuidToString(message.adminDelete.targetAuthorAciBinary),
          Number(message.adminDelete.targetSentTimestamp),
          source.authorAci,
        );
      }
      return;
    }
    if (message.pollVote) {
      await this.applyPollVote(source.authorAci, message);
      return;
    }
    if (message.pollTerminate) {
      const target = await this.db.findMessage(source.authorAci, Number(message.pollTerminate.targetSentTimestamp));
      if (target) await this.putMessage({ ...target, isPollEnded: true });
      return;
    }
    if (message.pinMessage || message.unpinMessage) {
      await this.applyPin(conversation, message);
      return;
    }

    if (await this.db.findMessage(source.authorAci, source.sentAt)) return;

    const updated = await this.updateExpireTimer(conversation, source, message);
    if ((message.flags & DataMessage_Flags.EXPIRATION_TIMER_UPDATE)
      || (message.flags & DataMessage_Flags.PROFILE_KEY_UPDATE)
      || !hasMessageContent(message)) {
      return;
    }

    const expireTimer = message.expireTimer || undefined;
    const expirationStart = source.isOutgoing ? source.expirationStartTimestamp ?? source.sentAt : undefined;
    await this.addMessage(updated, {
      conversationId: updated.id,
      kind: 'message',
      authorAci: source.authorAci,
      authorDeviceId: source.authorDeviceId,
      sentAt: source.sentAt,
      receivedAt: Date.now(),
      serverTimestamp: source.serverTimestamp,
      isOutgoing: source.isOutgoing,
      dataMessage: toBinary(DataMessageSchema, message),
      body: message.body || undefined,
      expireTimer,
      expiresAt: expireTimer && expirationStart !== undefined ? expirationStart + expireTimer * 1000 : undefined,
      readAt: source.isOutgoing ? source.sentAt : undefined,
      recipientStatus: source.sentTo
        ? Object.fromEntries(source.sentTo.map(({ serviceId }) => [serviceId, 'sent' as const]))
        : undefined,
      isSealedSender: source.isSealedSender,
      serverGuid: source.serverGuid,
    });
  }

  private async handleEditMessage(source: MessageSource, edit: EditMessage) {
    const target = await this.db.findMessage(source.authorAci, Number(edit.targetSentTimestamp));
    if (!target?.dataMessage || !edit.dataMessage || target.deletedAt) return;
    if (!source.isOutgoing && (await this.db.getConversation(target.conversationId))?.isBlocked) return;

    await this.putMessage({
      ...target,
      revisions: [...target.revisions ?? [], {
        dataMessage: target.dataMessage, editedAt: target.editedAt ?? target.sentAt,
      }],
      dataMessage: toBinary(DataMessageSchema, edit.dataMessage),
      body: edit.dataMessage.body || undefined,
      editedAt: Number(edit.dataMessage.timestamp) || source.sentAt,
    });
  }

  private async handleSyncMessage(source: MessageSource, sync: SyncMessage) {
    const ownSource = { ...source, isOutgoing: true };

    for (const read of sync.read) {
      await this.applyReadSync(read.senderAci || uuidToString(read.senderAciBinary), Number(read.timestamp), source);
    }
    for (const viewed of sync.viewed) {
      const target = await this.db.findMessage(
        viewed.senderAci || uuidToString(viewed.senderAciBinary), Number(viewed.timestamp),
      );
      if (target) await this.putMessage({ ...target, viewedAt: source.serverTimestamp ?? Date.now() });
    }

    const { content } = sync;
    switch (content.case) {
      case 'sent':
        await this.handleSentTranscript(ownSource, content.value);
        break;
      case 'contacts':
        if (content.value.blob) await this.applyContactSync(await downloadAttachment(content.value.blob));
        break;
      case 'blocked':
        await this.applyBlockedSync(content.value);
        break;
      case 'configuration':
        await this.client.updateAccount({
          isReadReceiptsEnabled: content.value.readReceipts,
          isTypingIndicatorsEnabled: content.value.typingIndicators,
          isLinkPreviewsEnabled: content.value.linkPreviews,
        });
        break;
      case 'viewOnceOpen': {
        const { senderAci, senderAciBinary, timestamp } = content.value;
        const target = await this.db.findMessage(senderAci || uuidToString(senderAciBinary), Number(timestamp));
        if (target) await this.putMessage({ ...target, isViewOnceOpened: true, dataMessage: undefined });
        break;
      }
      case 'messageRequestResponse':
        await this.applyMessageRequestResponseSync(content.value);
        break;
      case 'deleteForMe':
        await this.applyDeleteForMeSync(content.value);
        break;
      default:
        break;
    }
  }

  private async handleSentTranscript(source: MessageSource, sent: SyncMessage_Sent) {
    const destinationAci = sent.destinationServiceId
      || (sent.destinationServiceIdBinary.length ? uuidToString(sent.destinationServiceIdBinary) : undefined);
    const transcriptSource: MessageSource = {
      ...source,
      sentAt: Number(sent.timestamp) || source.sentAt,
      destinationAci,
      sentTo: sent.unidentifiedStatus.map((status) => ({
        serviceId: status.destinationServiceId || uuidToString(status.destinationServiceIdBinary),
        isSealedSender: status.unidentified,
      })),
      expirationStartTimestamp: Number(sent.expirationStartTimestamp) || undefined,
    };

    if (sent.message) await this.handleDataMessage(transcriptSource, sent.message);
    if (sent.editMessage) await this.handleEditMessage(transcriptSource, sent.editMessage);
  }

  private async handleReceipt(senderAci: string, receipt: ReceiptMessage) {
    const { account } = this.client.getSenderContext();
    const status = STATUS_BY_RECEIPT_TYPE[receipt.type];
    for (const timestamp of receipt.timestamp) {
      const message = await this.db.findMessage(account.aci, Number(timestamp));
      if (!message?.recipientStatus || !(senderAci in message.recipientStatus)) continue;
      await this.putMessage({
        ...message,
        recipientStatus: {
          ...message.recipientStatus,
          [senderAci]: maxStatus(message.recipientStatus[senderAci], status),
        },
      });
    }
  }

  /** Turning typing indicators off also hides those of others */
  private async handleTyping(senderAci: string, typing: TypingMessage) {
    if (this.client.getSenderContext().account.isTypingIndicatorsEnabled === false) return;
    const conversationId = typing.groupId.length ? bufferToBase64(typing.groupId) : senderAci;
    if ((await this.db.getConversation(conversationId))?.isBlocked) return;
    this.events.onTyping({
      conversationId,
      senderAci,
      isTyping: typing.action === TypingMessage_Action.STARTED,
    });
  }

  private async getConversationForMessage(source: MessageSource, message: DataMessage) {
    if (message.groupV2?.masterKey.length) return this.getGroupConversationForMessage(source, message.groupV2);
    const aci = source.isOutgoing ? source.destinationAci : source.authorAci;
    if (!aci) return undefined;
    const conversation = await this.ensurePrivateConversation(aci);
    // Writing first accepts the message request
    return source.isOutgoing && !conversation.isAccepted
      ? this.putConversation({ ...conversation, isAccepted: true })
      : conversation;
  }

  /** Returns the private conversation with `aci`, creating it (and fetching the profile) when absent */
  getOrCreatePrivateConversation(aci: string) {
    return this.runSerial(() => this.ensurePrivateConversation(aci));
  }

  private async ensurePrivateConversation(aci: string) {
    const existing = await this.db.getConversation(aci);
    if (existing) return existing;
    const created = await this.putConversation({
      id: aci, localId: await this.db.allocateLocalId(), type: 'private', unreadCount: 0,
    });
    this.profileQueue = this.profileQueue.then(() => this.refreshProfile(aci)).catch(this.events.onError);
    return created;
  }

  private async getOrCreateGroupConversation(masterKey: Uint8Array, revision: number) {
    const id = getGroupId(masterKey);
    const existing = await this.db.getConversation(id);
    const conversation = existing ?? await this.putConversation({
      id, localId: await this.db.allocateLocalId(), type: 'group', masterKey, unreadCount: 0,
    });
    if (!existing || (existing.revision ?? -1) < revision) void this.refreshGroup(id, masterKey);
    return conversation;
  }

  /**
   * A group message at the next revision with its signed change applies the change and adds its notices
   * (Signal Desktop `updateGroupViaSingleChange`); other new revisions fetch the whole state
   */
  private async getGroupConversationForMessage(source: MessageSource, context: GroupContextV2) {
    const { masterKey, revision, groupChange } = context;
    const existing = await this.db.getConversation(getGroupId(masterKey));
    const state = existing?.groupState;
    if (!existing || !state || !groupChange.length || revision !== state.revision + 1) {
      return this.getOrCreateGroupConversation(masterKey, revision);
    }

    const change = this.readGroupChange(existing, groupChange);
    if (change?.revision !== revision) return this.getOrCreateGroupConversation(masterKey, revision);
    const { aci: selfAci } = await this.getAccount();
    const next = applyGroupChange(state, change);
    const updated = await this.storeGroupState(existing, next, {
      change, isOutgoing: source.isOutgoing, sentAt: source.sentAt,
    });
    // A state we kept while not a member, as when we asked to join, lacks the members
    const isMember = (group: GroupState) => group.members.some(({ aci }) => aci === selfAci);
    if (!isMember(state) && isMember(next)) void this.refreshGroup(existing.id, masterKey);
    return updated;
  }

  /** The decrypted change of a group message, or `undefined` when it is invalid or of a later change epoch */
  private readGroupChange(conversation: ConversationRecord, groupChange: Uint8Array) {
    try {
      const actions = verifyGroupChange(fromBinary(GroupChangeSchema, groupChange), conversation.id);
      const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(conversation.masterKey!);
      return actions && decryptGroupChange(secretParams, actions);
    } catch (err) {
      this.events.onError(err as Error);
      return undefined;
    }
  }

  /**
   * Stores a group state that this device led to: after our change, whose notices are ours, or of a group we
   * created (`isCreated` adds its notice) or joined, whose conversation starts here
   */
  applyGroupState(
    masterKey: Uint8Array,
    state: GroupState,
    { change, isCreated }: { change?: DecryptedGroupChange; isCreated?: boolean },
  ) {
    return this.runSerial(async () => {
      const id = getGroupId(masterKey);
      const { aci: selfAci } = await this.getAccount();
      const existing = await this.db.getConversation(id);
      // Groups we create, join or ask to join are past the message request (`messageRequests.ts`)
      const isJoining = !existing || isCreated || [
        ...change?.addMembers ?? [], ...change?.promotePendingMembers ?? [], ...change?.addRequestingMembers ?? [],
      ].some(({ aci }) => aci === selfAci);
      const conversation = existing ?? await this.putConversation({
        id, localId: await this.db.allocateLocalId(), type: 'group', masterKey, unreadCount: 0,
      });
      const sentAt = this.allocateTimestamp();
      const updated = await this.storeGroupState(
        isJoining ? { ...conversation, isAccepted: true } : conversation,
        state,
        change && { change, isOutgoing: true, sentAt },
      );
      if (!isCreated) return updated;

      const { conversation: withNotice } = await this.addMessage(updated, {
        conversationId: id,
        kind: 'groupUpdate',
        authorAci: '',
        actorAci: (await this.getAccount()).aci,
        groupUpdate: { type: 'create' },
        sentAt,
        receivedAt: sentAt,
        isOutgoing: true,
        readAt: sentAt,
      });
      return withNotice;
    });
  }

  /**
   * Tells the members, and invited users with an ACI, about a new revision. `groupChange` is the signed change
   * that led to it; `extraRecipients` are people the change concerns who are no longer in the group
   * (Signal Desktop `ts/jobs/helpers/sendGroupUpdate.preload.ts`).
   */
  async sendGroupUpdate(id: string, groupChange?: Uint8Array, extraRecipients: string[] = []) {
    const account = await this.getAccount();
    const conversation = await this.db.getConversation(id);
    const state = conversation?.groupState;
    if (!conversation || !state) throw new Error(`Unknown group ${id}`);

    const recipients = new Set([
      ...state.members.map(({ aci }) => aci),
      ...state.pendingMembers.map(({ serviceId }) => serviceId).filter((serviceId) => ACI_PATTERN.test(serviceId)),
      ...extraRecipients,
    ]);
    recipients.delete(account.aci);
    const timestamp = this.allocateTimestamp();
    const message = createOutgoingDataMessage(account, conversation, {}, timestamp, false);
    if (groupChange) message.groupV2!.groupChange = groupChange;
    return this.sendContentTo(conversation, [...recipients], { case: 'dataMessage', value: message }, { timestamp });
  }

  /**
   * Brings a group to its current revision outside the envelope queue, with its send endorsements, when one
   * change does not reach it. Members apply each change of the group log with its notices; others, and members
   * whose log cannot be applied, fetch the state. Concurrent refreshes of a group share one request.
   */
  refreshGroup(id: string, masterKey: Uint8Array) {
    const running = this.groupRefreshes.get(id);
    if (running) return running;

    const refresh = (async () => {
      const { account, store } = this.client.getSenderContext();
      const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
      const known = (await this.db.getConversation(id))?.groupState;
      const isMember = known?.members.some(({ aci }) => aci === account.aci);
      const caughtUp = isMember
        ? await this.applyGroupLog(id, secretParams, known!.revision).catch(this.events.onError)
        : undefined;
      const result = caughtUp ?? await this.storeFetchedGroup(id, masterKey);
      const { conversation, members, sendEndorsementsResponse } = result;
      if (members) {
        await saveGroupSendEndorsements(store, account.aci, id, secretParams, members, sendEndorsementsResponse);
      }
      return conversation;
    })();

    this.groupRefreshes.set(id, refresh);
    refresh.catch(this.events.onError).finally(() => this.groupRefreshes.delete(id));
    return refresh;
  }

  /** Stores the fetched group state unless a change applied meanwhile is newer; returns the members it stored */
  private async storeFetchedGroup(id: string, masterKey: Uint8Array) {
    const { account, connection } = this.client.getSenderContext();
    const { state, sendEndorsementsResponse } = await fetchGroup(account, connection, masterKey);
    return this.runSerial(async () => {
      const conversation = await this.db.getConversation(id);
      if (!conversation || (conversation.groupState?.revision ?? -1) > state.revision) return { conversation };
      return {
        conversation: await this.storeGroupState(conversation, state),
        members: state.members.map(({ aci }) => aci),
        sendEndorsementsResponse,
      };
    });
  }

  /**
   * Applies the changes after `fromRevision` from the group log, each with its notices; the state of the last
   * revision then replaces what the changes made (Signal Desktop `integrateGroupChanges`)
   */
  private async applyGroupLog(id: string, secretParams: Uint8Array, fromRevision: number) {
    const { account, connection } = this.client.getSenderContext();
    const { entries, sendEndorsementsResponse } = await fetchGroupLog(account, connection, secretParams, fromRevision);
    return this.runSerial(async () => {
      let conversation = (await this.db.getConversation(id))!;
      let state = conversation.groupState!;
      for (const { change, state: revisionState } of entries) {
        const actions = change?.actions.length ? fromBinary(GroupChange_ActionsSchema, change.actions) : undefined;
        const revision = actions?.version ?? revisionState?.version ?? -1;
        if (revision <= state.revision) continue;

        if (actions && revision === state.revision + 1) {
          const decrypted = decryptGroupChange(secretParams, actions);
          state = applyGroupChange(state, decrypted);
          conversation = await this.storeGroupState(conversation, state, {
            change: decrypted, isOutgoing: decrypted.sourceServiceId === account.aci, sentAt: Date.now(),
          });
        } else if (revisionState) {
          state = decryptGroupState(secretParams, revisionState);
          conversation = await this.storeGroupState(conversation, state);
        } else {
          throw new Error(`Group log of ${id} misses revision ${state.revision + 1}`);
        }
      }

      const last = entries[entries.length - 1]?.state;
      if (last?.version === state.revision) {
        state = decryptGroupState(secretParams, last);
        conversation = await this.storeGroupState(conversation, state);
      }
      return { conversation, members: state.members.map(({ aci }) => aci), sendEndorsementsResponse };
    });
  }

  /** Stores a group state and the profile keys it brings; a change adds its notices */
  private async storeGroupState(
    conversation: ConversationRecord,
    state: GroupState,
    applied?: { change: DecryptedGroupChange; isOutgoing: boolean; sentAt: number },
  ) {
    const { aci: selfAci } = await this.getAccount();
    const profileKeys = applied ? getChangeProfileKeys(applied.change) : state.members;
    for (const { aci, profileKey } of profileKeys) {
      if (profileKey && aci !== selfAci) await saveProfileKey(this.client.store, aci, profileKey);
    }

    let updated = await this.putConversation({
      ...conversation,
      revision: state.revision,
      title: state.title,
      description: state.description,
      memberAcis: state.members.map(({ aci }) => aci),
      adminAcis: state.members.filter(({ role }) => role === Member_Role.ADMINISTRATOR).map(({ aci }) => aci),
      expireTimer: state.expireTimer || undefined,
      isAnnouncementsOnly: state.isAnnouncementsOnly,
      avatarPath: state.avatarUrl,
      groupState: state,
    });
    if (!applied) return updated;

    const { change, isOutgoing, sentAt } = applied;
    const now = Date.now();
    const base = {
      conversationId: updated.id, authorAci: '', sentAt, receivedAt: now, isOutgoing, readAt: now,
    };
    for (const { actorAci, update } of buildGroupNotices(change)) {
      ({ conversation: updated } = await this.addMessage(updated, {
        ...base, kind: 'groupUpdate', actorAci, groupUpdate: update,
      }));
    }
    if (change.expireTimer) {
      ({ conversation: updated } = await this.addMessage(updated, {
        ...base, kind: 'timerUpdate', actorAci: change.sourceServiceId, expireTimer: change.expireTimer.value,
      }));
    }
    return updated;
  }

  /**
   * Private conversations take the disappearing timer of each message, unless its version is older than
   * the one we have or it has none while we have one. Groups keep the timer in their state, so their messages
   * do not change it.
   */
  private async updateExpireTimer(conversation: ConversationRecord, source: MessageSource, message: DataMessage) {
    const timer = message.expireTimer || undefined;
    const version = message.expireTimerVersion || undefined;
    const currentVersion = conversation.expireTimerVersion;
    if (conversation.type === 'group' || conversation.expireTimer === timer) return conversation;
    // Messages from clients without timer versions cannot override a versioned timer
    if (currentVersion && (!version || version < currentVersion)) return conversation;

    const updated = await this.putConversation({
      ...conversation,
      expireTimer: timer,
      expireTimerVersion: version ?? conversation.expireTimerVersion,
    });
    const { conversation: withNotice } = await this.addMessage(updated, {
      conversationId: updated.id,
      kind: 'timerUpdate',
      authorAci: '',
      actorAci: source.authorAci,
      sentAt: source.sentAt,
      receivedAt: Date.now(),
      isOutgoing: source.isOutgoing,
      expireTimer: timer,
      readAt: Date.now(),
    });
    return withNotice;
  }

  private async applyReaction(source: MessageSource, reaction: NonNullable<DataMessage['reaction']>) {
    const targetAci = reaction.targetAuthorAci || uuidToString(reaction.targetAuthorAciBinary);
    const target = await this.db.findMessage(targetAci, Number(reaction.targetSentTimestamp));
    if (!target || target.deletedAt) return;

    await this.putReaction(target, source.authorAci, reaction.remove ? undefined : {
      emoji: reaction.emoji, authorAci: source.authorAci, sentAt: source.sentAt,
    });
  }

  /** Replaces the reaction of `authorAci` on a message; Signal keeps one reaction per person */
  private putReaction(message: MessageRecord, authorAci: string, reaction?: MessageReaction) {
    const others = (message.reactions ?? []).filter((current) => current.authorAci !== authorAci);
    return this.putMessage({ ...message, reactions: reaction ? [...others, reaction] : others });
  }

  /** Remote deletes are allowed only to the author, or to group admins through `adminDelete` */
  private async applyDelete(authorAci: string, targetSentAt: number, adminAci?: string) {
    const target = await this.db.findMessage(authorAci, targetSentAt);
    if (!target || target.deletedAt) return;
    await this.putMessage({
      ...target,
      deletedByAdminAci: adminAci !== authorAci ? adminAci : undefined,
      dataMessage: undefined,
      revisions: undefined,
      body: undefined,
      reactions: undefined,
      deletedAt: Date.now(),
    });
  }

  private async applyPollVote(voterAci: string, message: DataMessage) {
    const vote = message.pollVote!;
    const target = await this.db.findMessage(
      uuidToString(vote.targetAuthorAciBinary), Number(vote.targetSentTimestamp),
    );
    if (!target || target.isPollEnded) return;

    const existing = target.pollVotes?.find(({ authorAci }) => authorAci === voterAci);
    if (existing && existing.voteCount >= vote.voteCount) return;
    await this.putMessage({
      ...target,
      pollVotes: [
        ...(target.pollVotes ?? []).filter(({ authorAci }) => authorAci !== voterAci),
        { authorAci: voterAci, optionIndexes: vote.optionIndexes, voteCount: vote.voteCount },
      ],
    });
  }

  private async applyPin(conversation: ConversationRecord, message: DataMessage) {
    const target = message.pinMessage ?? message.unpinMessage!;
    const targetMessage = await this.db.findMessage(
      uuidToString(target.targetAuthorAciBinary), Number(target.targetSentTimestamp),
    );
    if (!targetMessage) return;

    const others = (conversation.pinnedMessages ?? []).filter(({ messageId }) => messageId !== targetMessage.id);
    const pin = message.pinMessage;
    const now = Date.now();
    await this.putConversation({
      ...conversation,
      pinnedMessages: pin ? [...others, {
        messageId: targetMessage.id,
        pinnedAt: now,
        expiresAt: pin.pinDuration.case === 'pinDurationSeconds' ? now + pin.pinDuration.value * 1000 : undefined,
      }] : others,
    });
  }

  /** A read on another device covers every earlier message of the conversation too */
  private async applyReadSync(authorAci: string, sentAt: number, source: MessageSource) {
    const target = await this.db.findMessage(authorAci, sentAt);
    if (!target) return;

    const readAt = source.serverTimestamp ?? Date.now();
    for (const message of await this.db.getUnreadMessages(target.conversationId, target.id)) {
      await this.putMessage({
        ...message,
        readAt,
        expiresAt: message.expireTimer ? readAt + message.expireTimer * 1000 : undefined,
      });
    }
    const conversation = await this.db.getConversation(target.conversationId);
    if (conversation) {
      const unreadCount = (await this.db.getUnreadMessages(target.conversationId)).length;
      await this.putConversation({ ...conversation, unreadCount, isMarkedUnread: false });
    }
    this.scheduleExpiration();
  }

  private async applyContactSync(data: Uint8Array) {
    for (const contact of parseContactSync(data)) {
      if (!contact.aci) continue;
      const conversation = await this.ensurePrivateConversation(contact.aci);
      await this.putConversation({
        ...conversation,
        e164: contact.number ?? conversation.e164,
        systemName: contact.name ?? conversation.systemName,
      });
    }
  }

  /** The primary device sends its whole blocked list, which replaces ours */
  private async applyBlockedSync(blocked: NonNullable<Extract<SyncMessage['content'], { case: 'blocked' }>['value']>) {
    const blockedIds = new Set([
      ...blocked.acis,
      ...blocked.acisBinary.map(uuidToString),
      ...blocked.blockedAcis.map(({ aciBinary }) => uuidToString(aciBinary)),
      ...blocked.groupIds.map(bufferToBase64),
      ...blocked.blockedGroups.map(({ groupId }) => bufferToBase64(groupId)),
    ]);
    const blockedE164s = new Set([...blocked.numbers, ...blocked.blockedE164s.map(({ e164 }) => e164)]);
    blockedE164s.delete('');
    const unknownE164s = new Set(blockedE164s);

    for (const conversation of await this.db.getConversations()) {
      const isBlocked = blockedIds.has(conversation.id)
        || Boolean(conversation.e164 && blockedE164s.has(conversation.e164));
      if (Boolean(conversation.isBlocked) !== isBlocked) await this.putConversation({ ...conversation, isBlocked });
      blockedIds.delete(conversation.id);
      if (conversation.e164) unknownE164s.delete(conversation.e164);
    }
    // Unknown groups need their master key, so only private conversations are created here
    for (const id of blockedIds) {
      if (!ACI_PATTERN.test(id)) continue;
      const conversation = await this.ensurePrivateConversation(id);
      await this.putConversation({ ...conversation, isBlocked: true });
    }
    await this.client.store.setItem('blockedE164s', [...unknownE164s]);
  }

  /**
   * Sends our whole blocked list as it is at send time (Signal Desktop `getBlockSync` in
   * `ts/textsecure/SendMessage.preload.ts`)
   */
  private async sendBlockedList(context: SenderContext) {
    const blocked = (await this.db.getConversations()).filter(({ isBlocked }) => isBlocked);
    const acis = blocked.filter(({ type }) => type === 'private').map(({ id }) => id);
    const groupIds = blocked.filter(({ type }) => type === 'group').map(({ id }) => bufferFromBase64(id));
    const e164s = [...new Set([
      ...await this.client.store.getItem('blockedE164s') ?? [],
      ...blocked.map(({ e164 }) => e164).filter(Boolean),
    ])];

    await sendBlockedSync(context, {
      numbers: e164s,
      blockedE164s: e164s.map((e164) => ({ e164 })),
      acis,
      blockedAcis: acis.map((aci) => ({ aciBinary: uuidToBytes(aci) })),
      groupIds,
      blockedGroups: groupIds.map((groupId) => ({ groupId })),
    });
  }

  /** The delete is done here either way, so a failed sync is only reported */
  private async syncDeleteForMe(deleteForMe: MessageInitShape<typeof SyncMessage_DeleteForMeSchema>) {
    await this.sendWhenConnected(async (context) => {
      await sendDeleteForMeSync(context, deleteForMe);
    }).catch(this.events.onError);
  }

  private async applyMessageRequestResponseSync(
    response: NonNullable<Extract<SyncMessage['content'], { case: 'messageRequestResponse' }>['value']>,
  ) {
    const id = response.groupId.length
      ? bufferToBase64(response.groupId)
      : response.threadAci || uuidToString(response.threadAciBinary);
    const conversation = await this.db.getConversation(id);
    if (conversation) await this.applyMessageRequestResponse(conversation, response.type);
  }

  /**
   * Accepting unblocks and shares our profile; blocking and deleting stop sharing it; spam marks the conversation
   * reported (`applyMessageRequestResponse` in Signal Desktop `ts/models/conversations.preload.ts`)
   */
  private async applyMessageRequestResponse(conversation: ConversationRecord, type: MessageRequestResponseType) {
    const isAccept = type === SyncMessage_MessageRequestResponse_Type.ACCEPT;
    const isBlock = BLOCK_RESPONSES.has(type);
    const isDelete = DELETE_RESPONSES.has(type);

    if (isDelete) await this.deleteMessagesUpTo(conversation.id);
    return this.putConversation({
      ...conversation,
      isAccepted: isAccept || (!isBlock && !isDelete && conversation.isAccepted),
      isBlocked: !isAccept && (isBlock || conversation.isBlocked),
      isReported: SPAM_RESPONSES.has(type) || conversation.isReported,
      unreadCount: isDelete ? 0 : conversation.unreadCount,
      isMarkedUnread: isDelete ? false : conversation.isMarkedUnread,
      lastMessageId: isDelete ? undefined : conversation.lastMessageId,
    });
  }

  /** Signal Desktop `onDeleteForMeSync` in `ts/background.preload.ts` and `ts/util/deleteForMe.preload.ts` */
  private async applyDeleteForMeSync(deleteForMe: SyncMessage_DeleteForMe) {
    const changedIds = new Set<string>();

    for (const { conversation: identifier, messages } of deleteForMe.messageDeletes) {
      const conversation = await this.findConversation(identifier);
      if (!conversation) continue;
      for (const target of messages) {
        const message = await this.findAddressableMessage(conversation.id, target);
        if (message) await this.removeMessage(message);
      }
      changedIds.add(conversation.id);
    }

    for (const item of deleteForMe.conversationDeletes) {
      const conversation = await this.findConversation(item.conversation);
      if (!conversation) continue;
      // Disappearing messages may be gone here, so the latest lasting ones mark the end too
      const newest = await this.findNewestMessage(conversation.id, item.mostRecentMessages)
        ?? await this.findNewestMessage(conversation.id, item.mostRecentNonExpiringMessages);
      if (newest) await this.deleteMessagesUpTo(conversation.id, newest.id);
      if (item.isFullDelete) await this.deleteLocalOnlyConversation(conversation.id);
      changedIds.add(conversation.id);
    }

    for (const { conversation: identifier } of deleteForMe.localOnlyConversationDeletes) {
      const conversation = await this.findConversation(identifier);
      if (!conversation) continue;
      await this.deleteLocalOnlyConversation(conversation.id);
      changedIds.add(conversation.id);
    }

    for (const item of deleteForMe.attachmentDeletes) {
      const conversation = await this.findConversation(item.conversation);
      const message = conversation && item.targetMessage
        && await this.findAddressableMessage(conversation.id, item.targetMessage);
      if (message?.dataMessage) await this.deleteAttachment(message, item.clientUuid, item.fallbackDigest);
    }

    for (const id of changedIds) await this.updateLastMessage(id);
  }

  /** Removes the attachment with `clientUuid`, or else the one with `digest` (Signal Desktop `deleteAttachmentFromMessage`) */
  private async deleteAttachment(message: MessageRecord, clientUuid: Uint8Array, digest: Uint8Array) {
    const dataMessage = fromBinary(DataMessageSchema, message.dataMessage!);
    const { attachments } = dataMessage;
    let index = clientUuid.length ? attachments.findIndex((item) => buffersEqual(item.clientUuid, clientUuid)) : -1;
    if (index === -1 && digest.length) index = attachments.findIndex((item) => buffersEqual(item.digest, digest));
    if (index === -1) return;

    attachments.splice(index, 1);
    await this.putMessage({ ...message, dataMessage: toBinary(DataMessageSchema, dataMessage) });
  }

  /** A conversation with no message that other devices could name loses its remaining notices */
  private async deleteLocalOnlyConversation(conversationId: string) {
    const [addressable] = await this.db.findLatestMessages(conversationId, 1, isAddressableMessage);
    if (!addressable) await this.deleteMessagesUpTo(conversationId);
  }

  private async findConversation(identifier?: ConversationIdentifier) {
    const { case: kind, value } = identifier?.identifier ?? {};
    switch (kind) {
      case 'threadServiceId':
        return this.db.getConversation(value as string);
      case 'threadServiceIdBinary':
        // A 17-byte value is a PNI, which has no conversation here
        return (value as Uint8Array).length === UUID_BYTE_LENGTH
          ? this.db.getConversation(uuidToString(value as Uint8Array))
          : undefined;
      case 'threadGroupId':
        return this.db.getConversation(bufferToBase64(value as Uint8Array));
      case 'threadE164':
        return (await this.db.getConversations()).find(({ e164 }) => e164 === value);
      default:
        return undefined;
    }
  }

  private async findAddressableMessage(conversationId: string, target: AddressableMessage) {
    const { case: kind, value } = target.author;
    let authorAci: string | undefined;
    if (kind === 'authorServiceId') {
      authorAci = value;
    } else if (kind === 'authorServiceIdBinary' && value.length === UUID_BYTE_LENGTH) {
      authorAci = uuidToString(value);
    } else if (kind === 'authorE164') {
      authorAci = (await this.db.getConversations()).find(({ type, e164 }) => type === 'private' && e164 === value)?.id;
    }
    if (!authorAci || !target.sentTimestamp) return undefined;

    const message = await this.db.findMessage(authorAci, Number(target.sentTimestamp));
    return message?.conversationId === conversationId ? message : undefined;
  }

  /** The newest of the named messages that is still here; ids grow in arrival order */
  private async findNewestMessage(conversationId: string, targets: AddressableMessage[]) {
    let newest: MessageRecord | undefined;
    for (const target of targets) {
      const message = await this.findAddressableMessage(conversationId, target);
      if (message && (!newest || message.id > newest.id)) newest = message;
    }
    return newest;
  }

  private async removeMessage(message: MessageRecord) {
    await this.db.deleteMessage(message.id);
    this.changes.deletedMessages.push({ conversationId: message.conversationId, id: message.id });
  }

  /** Deletes the messages of a conversation up to `maxId`, every message by default */
  private async deleteMessagesUpTo(conversationId: string, maxId?: number) {
    for (const id of await this.db.deleteConversationMessages(conversationId, maxId)) {
      this.changes.deletedMessages.push({ conversationId, id });
    }
  }

  /** Points the conversation at its latest remaining message and recounts unread ones after deletes */
  private async updateLastMessage(conversationId: string) {
    const conversation = await this.db.getConversation(conversationId);
    if (!conversation) return undefined;
    const [last] = await this.db.getMessages(conversationId, 1);
    const unreadCount = (await this.db.getUnreadMessages(conversationId)).length;
    if (last?.id === conversation.lastMessageId && unreadCount === conversation.unreadCount) return conversation;
    return this.putConversation({
      ...conversation,
      lastMessageId: last?.id,
      lastMessageAt: last?.sentAt ?? conversation.lastMessageAt,
      unreadCount,
      isMarkedUnread: last ? conversation.isMarkedUnread : false,
    });
  }

  private async addMessage(conversation: ConversationRecord, record: NewMessageRecord) {
    const message = await this.db.addMessage(record);
    this.changes.messages.push(message);
    this.changes.addedMessageIds.push(message.id);
    const isIncoming = !record.isOutgoing && record.kind === 'message';
    const updated = await this.putConversation({
      ...conversation,
      lastMessageId: message.id,
      lastMessageAt: record.sentAt,
      unreadCount: conversation.unreadCount + (isIncoming ? 1 : 0),
      // New messages bring archived conversations back unless they are muted
      isArchived: conversation.isArchived && isIncoming && !isMuted(conversation) ? false : conversation.isArchived,
    });
    if (record.expiresAt) this.scheduleExpiration();
    return { message, conversation: updated };
  }

  private async putMessage(record: MessageRecord) {
    await this.db.putMessage(record);
    this.changes.messages.push(record);
    if (record.expiresAt) this.scheduleExpiration();
    return record;
  }

  private async putConversation(record: ConversationRecord) {
    await this.db.putConversation(record);
    this.changes.conversations.push(record);
    return record;
  }

  private queueDeliveryReceipt(senderAci: string, sentAt: number) {
    this.deliveryReceipts.set(senderAci, [...this.deliveryReceipts.get(senderAci) ?? [], sentAt]);
    this.deliveryReceiptTimer ??= setTimeout(() => {
      this.deliveryReceiptTimer = undefined;
      const batches = [...this.deliveryReceipts];
      this.deliveryReceipts.clear();
      const context = this.client.getSenderContext();
      for (const [aci, timestamps] of batches) {
        sendReceipts(context, aci, ReceiptMessage_Type.DELIVERY, timestamps).catch(this.events.onError);
      }
    }, DELIVERY_RECEIPT_DELAY_MS);
  }

  private scheduleExpiration() {
    clearTimeout(this.expirationTimer);
    void this.db.getNextExpiresAt().then((expiresAt) => {
      if (expiresAt === undefined) return;
      this.expirationTimer = setTimeout(() => {
        void this.runSerial(() => this.deleteExpiredMessages()).catch(this.events.onError);
      }, Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMEOUT_MS));
    });
  }

  private async deleteExpiredMessages() {
    for (const message of await this.db.getExpiredMessages(Date.now())) {
      await this.db.deleteMessage(message.id);
      this.changes.deletedMessages.push({ conversationId: message.conversationId, id: message.id });
    }
    this.flush();
    this.scheduleExpiration();
  }

  private runSerial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.serial.then(task);
    this.serial = result.then(() => undefined, () => undefined);
    return result.finally(() => this.flush());
  }

  private flush() {
    const { changes } = this;
    if (!changes.conversations.length && !changes.messages.length && !changes.deletedMessages.length) return;
    this.changes = createChanges();
    this.events.onChanges({
      conversations: dedupeById(changes.conversations),
      messages: dedupeById(changes.messages),
      addedMessageIds: changes.addedMessageIds,
      deletedMessages: changes.deletedMessages,
    });
  }
}

function createChanges(): MessageChanges {
  return {
    conversations: [], messages: [], addedMessageIds: [], deletedMessages: [],
  };
}

/** A data message from this device; `shouldIncludeTimer` adds the conversation's disappearing timer */
function createOutgoingDataMessage(
  account: AccountRecord,
  conversation: ConversationRecord,
  init: MessageInitShape<typeof DataMessageSchema>,
  timestamp: number,
  shouldIncludeTimer = true,
) {
  const message = create(DataMessageSchema, init);
  setOutgoingFields(message, account, conversation, timestamp);
  if (shouldIncludeTimer) {
    message.expireTimer = conversation.expireTimer ?? 0;
    message.expireTimerVersion = conversation.expireTimerVersion ?? 0;
  }
  return message;
}

/**
 * Sets the fields every data message from this device carries: timestamp, group and, once the message request is
 * accepted, our profile key
 */
function setOutgoingFields(
  message: DataMessage, account: AccountRecord, conversation: ConversationRecord, timestamp: number,
) {
  message.timestamp = BigInt(timestamp);
  message.profileKey = getIsConversationAccepted(conversation, account.aci)
    ? account.profileKey ?? message.profileKey
    : new Uint8Array();
  message.groupV2 = conversation.masterKey
    ? create(GroupContextV2Schema, { masterKey: conversation.masterKey, revision: conversation.revision })
    : undefined;
}

/** Members who receive our messages in a conversation; Note to Self has only us, which sends a sync alone */
function getRecipientAcis(conversation: ConversationRecord, selfAci: string) {
  return conversation.type === 'group'
    ? (conversation.memberAcis ?? []).filter((aci) => aci !== selfAci)
    : [conversation.id];
}

function buildPendingStatus(recipientAcis: string[]): Record<string, SendStatus> {
  return Object.fromEntries(recipientAcis.map((aci) => [aci, 'pending' as const]));
}

/** A recipient without a result got the message through the sync transcript alone (Note to Self) */
function getResultError(results: RecipientResult[], serviceId: string) {
  return results.find((result) => result.serviceId === serviceId)?.error;
}

/** Keeps the last version of each record */
function dedupeById<T extends { id: string | number }>(records: T[]) {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

/** Messages that other devices can find by author and timestamp; notices have no author */
function isAddressableMessage(message: MessageRecord) {
  return message.kind === 'message' && Boolean(message.authorAci);
}

function buildConversationIdentifier(
  conversation: ConversationRecord,
): MessageInitShape<typeof ConversationIdentifierSchema> {
  return {
    identifier: conversation.type === 'group'
      ? { case: 'threadGroupId', value: bufferFromBase64(conversation.id) }
      : { case: 'threadServiceId', value: conversation.id },
  };
}

function buildAddressableMessage(message: MessageRecord): MessageInitShape<typeof AddressableMessageSchema> {
  return {
    author: { case: 'authorServiceId', value: message.authorAci },
    sentTimestamp: BigInt(message.sentAt),
  };
}

function hasMessageContent(message: DataMessage) {
  return Boolean(message.body || message.attachments.length || message.sticker || message.contact.length
    || message.pollCreate || message.giftBadge || message.payment || message.quote);
}

function isMuted(conversation: ConversationRecord) {
  return Boolean(conversation.mutedUntil && conversation.mutedUntil > Date.now());
}

function maxStatus(current: SendStatus | undefined, next: SendStatus): SendStatus {
  return !current || STATUS_RANK[next] > STATUS_RANK[current] ? next : current;
}

function groupTimestampsByAuthor(messages: MessageRecord[]) {
  const byAuthor = new Map<string, number[]>();
  for (const { authorAci, sentAt } of messages) {
    byAuthor.set(authorAci, [...byAuthor.get(authorAci) ?? [], sentAt]);
  }
  return byAuthor;
}

/** The conversation id of a group: its base64 group identifier */
export function getGroupId(masterKey: Uint8Array) {
  const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
  const publicParams = wasm.GroupSecretParams_GetPublicParams(secretParams);
  return bufferToBase64(wasm.GroupPublicParams_GetGroupIdentifier(publicParams));
}
