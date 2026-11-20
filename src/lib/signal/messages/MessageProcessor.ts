import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type MessageDb from '../db/MessageDb';
import type {
  ConversationRecord, MessageRecord, NewMessageRecord, SendStatus,
} from '../db/MessageDb';
import type { GroupState } from '../groups/fetchGroup';
import type { DecryptedGroupChange } from '../groups/groupChange';
import type {
  DataMessage, EditMessage, GroupContextV2, ReceiptMessage, SyncMessage, SyncMessage_Sent, TypingMessage,
} from '../proto/generated/SignalService_pb';
import type { StorageRecord } from '../proto/generated/StorageService_pb';
import type { DecryptedEnvelope } from '../receiver/decryptEnvelope';
import type { RecipientResult } from '../sender/sendContent';
import type { OutgoingMessage } from '../sender/sendMessage';
import type { GroupTarget } from '../sender/sendToGroup';
import type SignalClient from '../SignalClient';
import type { AccountRecord } from '../store/SignalStore';

import { bufferFromBase64, bufferToBase64 } from '../../../util/encoding/buffer';
import { downloadAttachment } from '../attachments/downloadAttachment';
import { fetchGroup } from '../groups/fetchGroup';
import {
  applyGroupChange, decryptGroupChange, getChangeProfileKeys, verifyGroupChange,
} from '../groups/groupChange';
import { saveGroupSendEndorsements } from '../groups/groupSendEndorsements';
import { buildGroupNotices } from '../groups/groupUpdates';
import { fetchProfile } from '../profiles/fetchProfile';
import { saveProfileKey } from '../sender/sealedSender';
import {
  sendMessage, sendReadSync, sendReceipts, sendTyping, sendViewedSync, sendViewOnceOpenSync,
} from '../sender/sendMessage';
import { uuidToBytes, uuidToString } from '../serviceId';
import { parseContactSync } from '../sync/contactSync';
import { wasm } from '../wasm';

import { GroupChangeSchema, Member_Role } from '../proto/generated/Groups_pb';
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
};

const DELIVERY_RECEIPT_DELAY_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Signal Desktop `ts/util/canEditMessage.dom.ts` and `ts/util/getDeleteMaxAgeMs.std.ts`
const EDIT_MAX_AGE_MS = DAY_MS;
const MAX_EDIT_COUNT = 10;
const DELETE_FOR_EVERYONE_MAX_AGE_MS = DAY_MS;
export const LONG_TEXT_CONTENT_TYPE = 'text/x-signal-plain';
const ACI_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const STATUS_RANK: Record<SendStatus, number> = {
  failed: 0, pending: 1, sent: 2, delivered: 3, read: 4, viewed: 5,
};
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
      const outgoing = createOutgoingDataMessage(account, found, init, sentAt);
      const { message: added } = await this.addMessage(found, {
        conversationId,
        kind: 'message',
        authorAci: account.aci,
        authorDeviceId: account.deviceId,
        sentAt,
        receivedAt: sentAt,
        isOutgoing: true,
        dataMessage: toBinary(DataMessageSchema, outgoing),
        body: outgoing.body || undefined,
        expireTimer: found.expireTimer || undefined,
        expiresAt: found.expireTimer ? sentAt + found.expireTimer * 1000 : undefined,
        readAt: sentAt,
        recipientStatus: buildPendingStatus(getRecipientAcis(found, account.aci)),
      });
      onStored?.(added);
      return { conversation: found, message: added, dataMessage: outgoing };
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
      for (const { message } of found) await this.applyDelete(message.authorAci, message.sentAt);
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

  /** Deletes messages on this device only; other devices keep them, since `deleteForMe` sync is not sent yet */
  deleteForMe(messageIds: number[]) {
    return this.runSerial(async () => {
      for (const id of messageIds) {
        const message = await this.db.getMessage(id);
        if (!message) continue;
        await this.db.deleteMessage(id);
        this.changes.deletedMessages.push({ conversationId: message.conversationId, id });
      }
    });
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

    const context = this.client.getSenderContext();
    if (context.account.isReadReceiptsEnabled) {
      const receipted = viewed.filter(({ conversation }) => conversation.isAccepted).map(({ message }) => message);
      for (const [authorAci, timestamps] of groupTimestampsByAuthor(receipted)) {
        await sendReceipts(context, authorAci, ReceiptMessage_Type.VIEWED, timestamps);
      }
    }
    const views = viewed.map(({ message }) => ({ senderAci: message.authorAci, timestamp: message.sentAt }));
    await sendViewedSync(context, views);
    for (const [index, { isViewOnce }] of viewed.entries()) {
      if (isViewOnce) await sendViewOnceOpenSync(context, views[index]);
    }
  }

  /**
   * Sends a typing indicator to a conversation; it reaches only devices online now. Signal sends none while
   * typing indicators are turned off.
   */
  async sendTyping(conversationId: string, isTyping: boolean) {
    const conversation = await this.db.getConversation(conversationId);
    const context = this.client.getSenderContext();
    if (!conversation || context.account.isTypingIndicatorsEnabled === false) return;
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

    const context = this.client.getSenderContext();
    if (context.account.isReadReceiptsEnabled && conversation.isAccepted) {
      for (const [authorAci, timestamps] of groupTimestampsByAuthor(messages)) {
        await sendReceipts(context, authorAci, ReceiptMessage_Type.READ, timestamps);
      }
    }
    await sendReadSync(context, messages.map(({ authorAci, sentAt }) => ({ senderAci: authorAci, timestamp: sentAt })));
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
      for (const { record } of records) {
        if (record.case === 'contact') {
          const contact = record.value;
          const aci = contact.aci || (contact.aciBinary.length ? uuidToString(contact.aciBinary) : undefined);
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

  /** Fetches the profile behind a private conversation and stores its decrypted fields */
  async refreshProfile(aci: string) {
    const { store, connection } = this.client.getSenderContext();
    const recipient = await store.getRecipient(aci);
    if (!recipient?.profileKey) return;

    const profile = await fetchProfile(connection, aci, recipient.profileKey);
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
    const source: MessageSource = {
      authorAci: senderServiceId,
      authorDeviceId: senderDeviceId,
      sentAt: Number(envelope.clientTimestamp),
      serverTimestamp: Number(envelope.serverTimestamp) || undefined,
      isOutgoing: false,
      isSealedSender,
    };

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
        if (senderServiceId === this.client.getSenderContext().account.aci) {
          await this.handleSyncMessage(source, body.value);
        }
        break;
      case 'receiptMessage':
        await this.handleReceipt(senderServiceId, body.value);
        break;
      case 'typingMessage':
        this.handleTyping(senderServiceId, body.value);
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
          uuidToString(message.adminDelete.targetAuthorAciBinary), Number(message.adminDelete.targetSentTimestamp),
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
    });
  }

  private async handleEditMessage(source: MessageSource, edit: EditMessage) {
    const target = await this.db.findMessage(source.authorAci, Number(edit.targetSentTimestamp));
    if (!target?.dataMessage || !edit.dataMessage || target.deletedAt) return;

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
        await this.applyMessageRequestResponse(content.value);
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
  private handleTyping(senderAci: string, typing: TypingMessage) {
    if (this.client.getSenderContext().account.isTypingIndicatorsEnabled === false) return;
    this.events.onTyping({
      conversationId: typing.groupId.length ? bufferToBase64(typing.groupId) : senderAci,
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
      const existing = await this.db.getConversation(id);
      const conversation = existing ?? await this.putConversation({
        id, localId: await this.db.allocateLocalId(), type: 'group', masterKey, unreadCount: 0, isAccepted: true,
      });
      const sentAt = this.allocateTimestamp();
      const updated = await this.storeGroupState(conversation, state, change && { change, isOutgoing: true, sentAt });
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
   * Fetches the group state outside the envelope queue, with its send endorsements, for revisions that one
   * change does not reach. Concurrent refreshes of a group share one fetch.
   */
  refreshGroup(id: string, masterKey: Uint8Array) {
    const running = this.groupRefreshes.get(id);
    if (running) return running;

    const refresh = (async () => {
      const { account, connection, store } = this.client.getSenderContext();
      const { state, sendEndorsementsResponse } = await fetchGroup(account, connection, masterKey);
      const updated = await this.runSerial(async () => {
        const conversation = await this.db.getConversation(id);
        return conversation && this.storeGroupState(conversation, state);
      });
      await saveGroupSendEndorsements(
        store,
        account.aci,
        id,
        wasm.GroupSecretParams_DeriveFromMasterKey(masterKey),
        state.members.map(({ aci }) => aci),
        sendEndorsementsResponse,
      );
      return updated;
    })();

    this.groupRefreshes.set(id, refresh);
    refresh.catch(this.events.onError).finally(() => this.groupRefreshes.delete(id));
    return refresh;
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
      isAccepted: conversation.isAccepted || state.members.some(({ aci }) => aci === selfAci),
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
  private async applyDelete(authorAci: string, targetSentAt: number) {
    const target = await this.db.findMessage(authorAci, targetSentAt);
    if (!target || target.deletedAt) return;
    await this.putMessage({
      ...target,
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

  private async applyBlockedSync(blocked: NonNullable<Extract<SyncMessage['content'], { case: 'blocked' }>['value']>) {
    const blockedIds = new Set([
      ...blocked.acis,
      ...blocked.acisBinary.map(uuidToString),
      ...blocked.blockedAcis.map(({ aciBinary }) => uuidToString(aciBinary)),
      ...blocked.groupIds.map(bufferToBase64),
      ...blocked.blockedGroups.map(({ groupId }) => bufferToBase64(groupId)),
    ]);
    for (const conversation of await this.db.getConversations()) {
      const isBlocked = blockedIds.has(conversation.id);
      if (Boolean(conversation.isBlocked) !== isBlocked) await this.putConversation({ ...conversation, isBlocked });
      blockedIds.delete(conversation.id);
    }
    // Unknown groups need their master key, so only private conversations are created here
    for (const id of blockedIds) {
      if (!ACI_PATTERN.test(id)) continue;
      const conversation = await this.ensurePrivateConversation(id);
      await this.putConversation({ ...conversation, isBlocked: true });
    }
  }

  private async applyMessageRequestResponse(
    response: NonNullable<Extract<SyncMessage['content'], { case: 'messageRequestResponse' }>['value']>,
  ) {
    const id = response.groupId.length
      ? bufferToBase64(response.groupId)
      : response.threadAci || uuidToString(response.threadAciBinary);
    const conversation = await this.db.getConversation(id);
    if (!conversation) return;

    const { type } = response;
    const isBlock = type === SyncMessage_MessageRequestResponse_Type.BLOCK
      || type === SyncMessage_MessageRequestResponse_Type.BLOCK_AND_DELETE
      || type === SyncMessage_MessageRequestResponse_Type.BLOCK_AND_SPAM;
    const isDelete = type === SyncMessage_MessageRequestResponse_Type.DELETE
      || type === SyncMessage_MessageRequestResponse_Type.BLOCK_AND_DELETE;

    if (isDelete) {
      for (const messageId of await this.db.deleteConversationMessages(id)) {
        this.changes.deletedMessages.push({ conversationId: id, id: messageId });
      }
    }
    await this.putConversation({
      ...conversation,
      isAccepted: type === SyncMessage_MessageRequestResponse_Type.ACCEPT || conversation.isAccepted,
      isBlocked: isBlock || conversation.isBlocked,
      unreadCount: isDelete ? 0 : conversation.unreadCount,
      lastMessageId: isDelete ? undefined : conversation.lastMessageId,
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

/** Sets the fields every data message from this device carries: timestamp, profile key and group */
function setOutgoingFields(
  message: DataMessage, account: AccountRecord, conversation: ConversationRecord, timestamp: number,
) {
  message.timestamp = BigInt(timestamp);
  message.profileKey = account.profileKey ?? message.profileKey;
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
function getGroupId(masterKey: Uint8Array) {
  const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
  const publicParams = wasm.GroupSecretParams_GetPublicParams(secretParams);
  return bufferToBase64(wasm.GroupPublicParams_GetGroupIdentifier(publicParams));
}
