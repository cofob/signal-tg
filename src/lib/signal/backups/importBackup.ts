import { fromBinary } from '@bufbuild/protobuf';

import type MessageProcessor from '../messages/MessageProcessor';
import type { ConversationPatch, HistoryBatch } from '../messages/MessageProcessor';
import type {
  AccountData, Chat, ChatItem, Contact, Group, Recipient,
} from '../proto/generated/Backup_pb';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord } from '../store/SignalStore';
import type { ChatItemContext } from './backupChatItems';

import { buffersEqual } from '../../../util/encoding/buffer';
import { getServerTime } from '../../../util/serverTime';
import { buildChatStyleRecord, buildCustomChatColors } from '../chatStyle/chatStyle';
import { saveProfileKey } from '../sender/sealedSender';
import { uuidToString } from '../serviceId';
import { convertChatItem } from './backupChatItems';

import { getGroupId } from '../messages/MessageProcessor';
import {
  BackupInfoSchema, Contact_IdentityState, FrameSchema, Group_Member_Role,
} from '../proto/generated/Backup_pb';
import { Verified_State } from '../proto/generated/SignalService_pb';

export type BackupImportContext = {
  store: SignalStore;
  processor: MessageProcessor;
  account: AccountRecord;
  // The account is in use: the backup fills what the account lacks, and the account's own settings, chat states and
  // last messages stay
  isMerge?: boolean;
  // Chat items an interrupted import stored already
  skipItemCount: number;
  updateAccount(update: Partial<AccountRecord>): Promise<void>;
  // Runs after each stored batch with the number of chat items stored so far, including skipped ones
  onBatchStored(importedItemCount: number): Promise<void>;
};

export type BackupImportResult = {
  messageCount: number;
  // Frames and chat items left out, by kind or reason
  skipped: Record<string, number>;
  errors: string[];
};

// Signal Desktop `BACKUP_VERSION` in `ts/services/backups/constants.std.ts`
const BACKUP_VERSION = 1n;
const VERIFIED_STATE_BY_IDENTITY_STATE: Record<Contact_IdentityState, Verified_State> = {
  [Contact_IdentityState.DEFAULT]: Verified_State.DEFAULT,
  [Contact_IdentityState.VERIFIED]: Verified_State.VERIFIED,
  [Contact_IdentityState.UNVERIFIED]: Verified_State.UNVERIFIED,
};
const BATCH_SIZE = 500;
const MAX_LOGGED_ERRORS = 10;
const MS_PER_SECOND = 1000;

/**
 * Imports the frames of a backup into the message database (Signal Desktop `BackupImportStream` in
 * `ts/services/backups/import.preload.ts`): account data, contacts, groups and our own recipient, chats with
 * their settings, and chat items in rendering order. Distribution lists, call links, calls, sticker packs,
 * notification profiles and chat folders are skipped, and counted in the result. Like Signal Desktop, a frame
 * that fails is counted and the import goes on; only the backup header and the account data are required.
 */
export async function importBackupFrames(frames: AsyncIterable<Uint8Array>, context: BackupImportContext) {
  const importer = new BackupImporter(context);
  for await (const frame of frames) {
    await importer.addFrame(frame);
  }
  return importer.finish();
}

class BackupImporter {
  private hasInfo = false;

  private hasAccountData = false;

  private itemContext: ChatItemContext;

  private conversations = new Map<string, ConversationPatch>();

  private messages: HistoryBatch['messages'] = [];

  private itemCount = 0;

  private result: BackupImportResult = { messageCount: 0, skipped: {}, errors: [] };

  // Recipients that are conversations: contacts with an ACI, groups and ourselves
  private recipientConversations = new Map<bigint, Pick<ConversationPatch, 'id' | 'type'>>();

  constructor(private context: BackupImportContext) {
    this.itemContext = {
      selfAci: context.account.aci,
      recipientAcis: new Map(),
      chatConversationIds: new Map(),
      now: getServerTime() * MS_PER_SECOND,
    };
  }

  async addFrame(data: Uint8Array) {
    if (!this.hasInfo) {
      await this.applyBackupInfo(data);
      return;
    }

    const { item } = fromBinary(FrameSchema, data);
    if (item.case === 'account') {
      await this.applyAccountData(item.value);
      return;
    }
    if (!this.hasAccountData) throw new Error('Backup frames come before the account data');

    try {
      switch (item.case) {
        case 'recipient':
          await this.addRecipient(item.value);
          break;
        case 'chat':
          this.addChat(item.value);
          break;
        case 'chatItem':
          this.addChatItem(item.value);
          break;
        default:
          this.skip(item.case ?? 'unknown');
      }
    } catch (err) {
      this.skip('error');
      if (this.result.errors.length < MAX_LOGGED_ERRORS) this.result.errors.push(String(err));
    }
    // Outside the frame's error handling: a batch that fails to store ends the import
    if (this.messages.length >= BATCH_SIZE) await this.flush();
  }

  async finish() {
    await this.flush();
    return this.result;
  }

  /** The header: a supported version and the media root key that the provisioning message brought */
  private async applyBackupInfo(data: Uint8Array) {
    const { version, mediaRootBackupKey } = fromBinary(BackupInfoSchema, data);
    if (version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${version}`);
    this.hasInfo = true;

    const ourKey = this.context.account.mediaRootBackupKey;
    if (!mediaRootBackupKey.length) throw new Error('Backup has no media root key');
    if (!ourKey) {
      await this.context.updateAccount({ mediaRootBackupKey });
    } else if (!this.context.isMerge && !buffersEqual(ourKey, mediaRootBackupKey)) {
      // An account in use keeps its key, which a backup of another device of the account need not share
      throw new Error('Backup has a different media root key');
    }
  }

  private async applyAccountData(data: AccountData) {
    if (this.hasAccountData) throw new Error('Backup has more than one account data frame');
    this.hasAccountData = true;

    const { account, isMerge } = this.context;
    const settings = data.accountSettings;
    // A merge keeps the setting that the account has
    const take = <T>(current: T | undefined, imported: T | undefined) => (isMerge ? current ?? imported : imported);
    await this.context.updateAccount({
      profileKey: account.profileKey ?? (data.profileKey.length ? data.profileKey : undefined),
      isReadReceiptsEnabled: settings ? take(account.isReadReceiptsEnabled, settings.readReceipts)
        : account.isReadReceiptsEnabled,
      isTypingIndicatorsEnabled: settings ? take(account.isTypingIndicatorsEnabled, settings.typingIndicators)
        : account.isTypingIndicatorsEnabled,
      isLinkPreviewsEnabled: settings ? take(account.isLinkPreviewsEnabled, settings.linkPreviews)
        : account.isLinkPreviewsEnabled,
      defaultChatStyle: take(account.defaultChatStyle, buildChatStyleRecord(settings?.defaultChatStyle)),
      customChatColors: take(account.customChatColors, buildCustomChatColors(settings?.customChatColors ?? [])),
    });
    this.patchConversation({
      id: account.aci,
      type: 'private',
      profileName: data.givenName || undefined,
      profileFamilyName: data.familyName || undefined,
      about: data.bioText || undefined,
      aboutEmoji: data.bioEmoji || undefined,
      username: data.username || undefined,
      avatarPath: data.avatarUrlPath || undefined,
    });
  }

  private async addRecipient({ id, destination }: Recipient) {
    switch (destination.case) {
      case 'self':
        this.addRecipientConversation(id, { id: this.context.account.aci, type: 'private' }, this.context.account.aci);
        break;
      case 'contact':
        await this.addContact(id, destination.value);
        break;
      case 'group':
        this.addGroup(id, destination.value);
        break;
      default:
        // Release notes, distribution lists and call links are not conversations here
        this.skip(destination.case ?? 'unknownRecipient');
    }
  }

  /** Contacts without an ACI (known only by phone number) are left out: conversations are keyed by ACI */
  private async addContact(id: bigint, contact: Contact) {
    const aci = contact.aci?.length ? uuidToString(contact.aci) : undefined;
    if (!aci || aci === this.context.account.aci) {
      this.skip('contactWithoutAci');
      return;
    }
    if (contact.profileKey?.length) await saveProfileKey(this.context.store, aci, contact.profileKey);
    if (contact.identityKey?.length) await this.addIdentity(aci, contact.identityKey, contact.identityState);

    this.addRecipientConversation(id, { id: aci, type: 'private' }, aci);
    this.patchConversation({
      id: aci,
      type: 'private',
      e164: contact.e164 ? `+${contact.e164}` : undefined,
      profileName: contact.profileGivenName || undefined,
      profileFamilyName: contact.profileFamilyName || undefined,
      systemName: joinName(contact.systemGivenName, contact.systemFamilyName),
      nickname: joinName(contact.nickname?.given, contact.nickname?.family),
      username: contact.username || undefined,
      isBlocked: contact.blocked,
      isAccepted: contact.profileSharing,
    });
  }

  /**
   * The identity key and verification of a contact, so safety numbers and verified contacts carry over (Signal
   * Desktop `#fromContact`). A key we have stored already is newer and stays.
   */
  private async addIdentity(aci: string, publicKey: Uint8Array, identityState: Contact_IdentityState) {
    const { store } = this.context;
    await store.runExclusive(async () => {
      if (await store.getIdentity(aci)) return;
      await store.setIdentity(aci, { publicKey, verified: VERIFIED_STATE_BY_IDENTITY_STATE[identityState] });
    });
  }

  /** The group state comes from the snapshot in the backup, without a request to the groups service */
  private addGroup(id: bigint, group: Group) {
    if (!group.masterKey.length) throw new Error('Backup group has no master key');
    const conversationId = getGroupId(group.masterKey);
    this.addRecipientConversation(id, { id: conversationId, type: 'group' });

    const { snapshot } = group;
    const memberAcis = snapshot?.members.map(({ userId }) => uuidToString(userId)) ?? [];
    const title = snapshot?.title?.content;
    const description = snapshot?.description?.content;
    const timer = snapshot?.disappearingMessagesTimer?.content;
    this.patchConversation({
      id: conversationId,
      type: 'group',
      masterKey: group.masterKey,
      revision: snapshot?.version,
      title: title?.case === 'title' ? title.value : undefined,
      description: description?.case === 'descriptionText' ? description.value : undefined,
      avatarPath: snapshot?.avatarUrl || undefined,
      expireTimer: timer?.case === 'disappearingMessagesDuration' ? timer.value || undefined : undefined,
      memberAcis,
      adminAcis: snapshot?.members
        .filter(({ role }) => role === Group_Member_Role.ADMINISTRATOR)
        .map(({ userId }) => uuidToString(userId)),
      isAnnouncementsOnly: snapshot?.announcementsOnly,
      isBlocked: group.blocked,
      // Membership alone leaves a group a message request (`messageRequests.ts`)
      isAccepted: group.whitelisted,
    });
  }

  private addRecipientConversation(id: bigint, conversation: Pick<ConversationPatch, 'id' | 'type'>, aci?: string) {
    this.recipientConversations.set(id, conversation);
    if (aci) this.itemContext.recipientAcis.set(id, aci);
  }

  /** Chats carry the list state and settings of their recipient's conversation */
  private addChat(chat: Chat) {
    const conversation = this.recipientConversations.get(chat.recipientId);
    if (!conversation) {
      this.skip('chatWithoutConversation');
      return;
    }
    this.itemContext.chatConversationIds.set(chat.id, conversation.id);
    this.patchConversation({
      ...conversation,
      isArchived: chat.archived,
      // Zero is not pinned; pinned chats show in ascending order from one, and the index from zero
      pinIndex: chat.pinnedOrder ? chat.pinnedOrder - 1 : undefined,
      expireTimer: chat.expirationTimerMs ? Math.round(Number(chat.expirationTimerMs) / MS_PER_SECOND) : undefined,
      expireTimerVersion: chat.expireTimerVersion || undefined,
      mutedUntil: chat.muteUntilMs ? Number(chat.muteUntilMs) : undefined,
      isMarkedUnread: chat.markedUnread,
      chatStyle: buildChatStyleRecord(chat.style),
    });
  }

  private addChatItem(item: ChatItem) {
    // Chat items keep their order across runs, so the count identifies what an earlier run stored
    const index = this.itemCount++;
    if (index < this.context.skipItemCount) return;

    const converted = convertChatItem(item, this.itemContext);
    if (typeof converted === 'string') {
      this.skip(converted);
      return;
    }
    this.messages.push(converted);
  }

  private patchConversation(patch: ConversationPatch) {
    this.conversations.set(patch.id, { ...this.conversations.get(patch.id), ...patch });
  }

  private async flush() {
    const batch: HistoryBatch = {
      conversations: [...this.conversations.values()], messages: this.messages, isMerge: this.context.isMerge,
    };
    this.conversations = new Map();
    this.messages = [];
    if (batch.conversations.length || batch.messages.length) {
      this.result.messageCount += await this.context.processor.importHistory(batch);
    }
    await this.context.onBatchStored(this.itemCount);
  }

  private skip(reason: string) {
    this.result.skipped[reason] = (this.result.skipped[reason] ?? 0) + 1;
  }
}

function joinName(...parts: (string | undefined)[]) {
  return parts.filter(Boolean).join(' ') || undefined;
}
