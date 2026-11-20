import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type MessageDb from '../db/MessageDb';
import type {
  ConversationRecord, MessageRecord, NewMessageRecord, SendStatus,
} from '../db/MessageDb';
import type {
  DataMessage, EditMessage, ReceiptMessage, SyncMessage, SyncMessage_Sent, TypingMessage,
} from '../proto/generated/SignalService_pb';
import type { StorageRecord } from '../proto/generated/StorageService_pb';
import type { DecryptedEnvelope } from '../receiver/decryptEnvelope';
import type SignalClient from '../SignalClient';

import { bufferFromBase64, bufferToBase64 } from '../../../util/encoding/buffer';
import { downloadAttachment } from '../attachments/downloadAttachment';
import { fetchGroup } from '../groups/fetchGroup';
import { fetchProfile } from '../profiles/fetchProfile';
import { saveProfileKey } from '../sender/sealedSender';
import { sendMessage, sendReadSync, sendReceipts } from '../sender/sendMessage';
import { uuidToString } from '../serviceId';
import { parseContactSync } from '../sync/contactSync';
import { wasm } from '../wasm';

import { Member_Role } from '../proto/generated/Groups_pb';
import {
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
  deletedMessages: { conversationId: string; id: number }[];
};

export type TypingEvent = {
  conversationId: string;
  senderAci: string;
  isTyping: boolean;
};

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

  private groupRefreshes = new Map<string, Promise<void>>();

  // Profiles of new conversations are fetched one at a time to stay within the server's rate limit
  private profileQueue = Promise.resolve();

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
   * recipient's status follows the send.
   */
  async sendDataMessage(conversationId: string, init: MessageInitShape<typeof DataMessageSchema>) {
    const context = this.client.getSenderContext();
    const { account } = context;
    const sentAt = Date.now();

    const {
      conversation, message, recipients, dataMessage,
    } = await this.runSerial(async () => {
      // An ACI that has no conversation yet starts one
      const found = await this.db.getConversation(conversationId)
        ?? (ACI_PATTERN.test(conversationId) ? await this.ensurePrivateConversation(conversationId) : undefined);
      if (!found) throw new Error(`Unknown conversation ${conversationId}`);
      const recipientAcis = found.type === 'group'
        ? (found.memberAcis ?? []).filter((aci) => aci !== account.aci)
        : [found.id];
      const outgoing = create(DataMessageSchema, init);
      outgoing.timestamp = BigInt(sentAt);
      outgoing.profileKey = account.profileKey ?? outgoing.profileKey;
      outgoing.expireTimer = found.expireTimer ?? 0;
      outgoing.expireTimerVersion = found.expireTimerVersion ?? 0;
      outgoing.groupV2 = found.masterKey
        ? create(GroupContextV2Schema, { masterKey: found.masterKey, revision: found.revision })
        : undefined;
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
        recipientStatus: Object.fromEntries(recipientAcis.map((aci) => [aci, 'pending' as const])),
      });
      return {
        conversation: found, message: added, recipients: recipientAcis, dataMessage: outgoing,
      };
    });

    const results = await sendMessage(context, recipients, { case: 'dataMessage', value: dataMessage }, {
      timestamp: sentAt,
      groupId: conversation.type === 'group' ? bufferFromBase64(conversation.id) : undefined,
      expirationStartTimestamp: conversation.expireTimer ? sentAt : undefined,
    });

    return this.runSerial(async () => {
      const current = await this.db.getMessage(message.id);
      if (!current) return message;
      const recipientStatus = { ...current.recipientStatus };
      for (const { serviceId, error } of results) {
        recipientStatus[serviceId] = error ? 'failed' : maxStatus(recipientStatus[serviceId], 'sent');
      }
      return this.putMessage({ ...current, recipientStatus });
    }).finally(() => this.flush());
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

  private handleTyping(senderAci: string, typing: TypingMessage) {
    this.events.onTyping({
      conversationId: typing.groupId.length ? bufferToBase64(typing.groupId) : senderAci,
      senderAci,
      isTyping: typing.action === TypingMessage_Action.STARTED,
    });
  }

  private async getConversationForMessage(source: MessageSource, message: DataMessage) {
    const masterKey = message.groupV2?.masterKey;
    if (masterKey?.length) {
      return this.getOrCreateGroupConversation(masterKey, message.groupV2!.revision);
    }
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
    if (!existing || (existing.revision ?? -1) < revision) this.refreshGroup(id, masterKey);
    return conversation;
  }

  /** Fetches the group state outside the envelope queue; group changes are not applied one by one yet */
  private refreshGroup(id: string, masterKey: Uint8Array) {
    if (this.groupRefreshes.has(id)) return;

    const refresh = (async () => {
      const { account, connection, store } = this.client.getSenderContext();
      const group = await fetchGroup(account, connection, masterKey);
      for (const member of group.members) {
        if (member.profileKey && member.aci !== account.aci) await saveProfileKey(store, member.aci, member.profileKey);
      }
      await this.runSerial(async () => {
        const conversation = await this.db.getConversation(id);
        if (!conversation) return;
        await this.putConversation({
          ...conversation,
          revision: group.revision,
          title: group.title,
          description: group.description,
          memberAcis: group.members.map(({ aci }) => aci),
          adminAcis: group.members.filter(({ role }) => role === Member_Role.ADMINISTRATOR).map(({ aci }) => aci),
          expireTimer: group.expireTimer || undefined,
          isAnnouncementsOnly: group.isAnnouncementsOnly,
          avatarPath: group.avatarUrl,
          isAccepted: conversation.isAccepted || group.members.some(({ aci }) => aci === account.aci),
        });
      });
      this.flush();
    })();

    this.groupRefreshes.set(id, refresh);
    refresh.catch(this.events.onError).finally(() => this.groupRefreshes.delete(id));
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

    const others = (target.reactions ?? []).filter(({ authorAci }) => authorAci !== source.authorAci);
    await this.putMessage({
      ...target,
      reactions: reaction.remove
        ? others
        : [...others, { emoji: reaction.emoji, authorAci: source.authorAci, sentAt: source.sentAt }],
    });
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
      deletedMessages: changes.deletedMessages,
    });
  }
}

function createChanges(): MessageChanges {
  return { conversations: [], messages: [], deletedMessages: [] };
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
