import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type MessageDb from '../db/MessageDb';
import type { ConversationRecord, MessageRecord, SendErrorKind } from '../db/MessageDb';
import type { GroupMember, GroupState } from '../groups/fetchGroup';
import type { GroupUpdate } from '../groups/groupUpdates';
import type { AccountDataSchema,
  ChatItemSchema,
  Frame,
  GroupChangeChatUpdate_UpdateSchema,
  ReactionSchema, SendStatusSchema } from '../proto/generated/Backup_pb';
import type {
  AttachmentPointer, BodyRange, DataMessage, DataMessage_Contact,
} from '../proto/generated/SignalService_pb';
import type {
  ChatFolderRecord, NotificationProfile as StorageNotificationProfile, Recipient as StorageRecipient,
} from '../proto/generated/StorageService_pb';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord, StoryDistributionList } from '../store/SignalStore';

import { bufferFromHex, bufferToBase64 } from '../../../util/encoding/buffer';
import { getServerTime } from '../../../util/serverTime';
import { buildBackupChatStyle, buildBackupCustomChatColors } from '../chatStyle/chatStyle';
import { getIsConversationAccepted } from '../messages/messageRequests';
import { uuidToBytes, uuidToString } from '../serviceId';
import { sortInstalledStickerPacks } from '../stickers/stickerPacks';
import { MY_STORY_ID } from '../stories/storyLists';

import { getGroupId, LONG_TEXT_CONTENT_TYPE } from '../messages/MessageProcessor';
import {
  AccountData_AccountSettings_UnreadBadgeType,
  AccountData_AppTheme,
  AccountData_CallsUseLessDataSetting,
  AccountData_PhoneNumberSharingMode,
  AccountData_SentMediaQuality,
  BackupInfoSchema,
  BodyRange_Style as BackupBodyRangeStyle,
  ChatFolder_FolderType,
  ChatItem_DirectionlessMessageDetailsSchema,
  ChatUpdateMessageSchema,
  Contact_IdentityState,
  Contact_RegisteredSchema,
  ContactAttachment_Email_Type as BackupEmailType,
  ContactAttachment_Phone_Type as BackupPhoneType,
  ContactAttachment_PostalAddress_Type as BackupAddressType,
  DistributionList_PrivacyMode,
  FrameSchema,
  Group_AccessControl_AccessRequired,
  Group_Member_Role,
  GroupV2AccessLevel,
  MessageAttachment_Flag,
  NotificationProfile_DayOfWeek,
  Quote_Type,
  ReleaseNotesSchema,
  RemoteDeletedMessageSchema,
  SelfSchema,
  SendStatus_Failed_FailureReason,
  SendStatus_PendingSchema,
  SimpleChatUpdate_Type,
} from '../proto/generated/Backup_pb';
import {
  AttachmentPointer_Flags,
  BodyRange_Style,
  DataMessage_Contact_Email_Type as EmailType,
  DataMessage_Contact_Phone_Type as PhoneType,
  DataMessage_Contact_PostalAddress_Type as AddressType,
  DataMessage_Quote_Type,
  DataMessageSchema,
  Verified_State,
} from '../proto/generated/SignalService_pb';
import {
  ChatFolderRecord_FolderType, ManifestRecordSchema, StorageRecordSchema,
} from '../proto/generated/StorageService_pb';

export type BackupExportStats = {
  contacts: number;
  groups: number;
  chats: number;
  chatItems: number;
  // Messages and notices that the backup has no place for, by reason
  skipped: Record<string, number>;
};

export type BackupExport = {
  // The serialized `BackupInfo` header
  info: Uint8Array<ArrayBuffer>;
  frames: AsyncGenerator<Frame>;
  stats: BackupExportStats;
};

type ExportOptions = {
  store: SignalStore;
  db: MessageDb;
  account: AccountRecord;
  appVersion: string;
  // The backup tier of the account, which the account data reports
  backupTier?: number;
  // Milliseconds since the epoch: messages sent earlier are left out, which shrinks a backup that the service refuses
  messageCutoffMs?: number;
};

type ChatItemInit = MessageInitShape<typeof ChatItemSchema>;
type ReactionInit = MessageInitShape<typeof ReactionSchema>;
type RecipientInit = Extract<NonNullable<MessageInitShape<typeof FrameSchema>['item']>, { case: 'recipient' }>['value'];
type UpdateInit = MessageInitShape<typeof ChatUpdateMessageSchema>;
type GroupUpdateInit = MessageInitShape<typeof GroupChangeChatUpdate_UpdateSchema>['update'];

// Signal Desktop `BACKUP_VERSION` in `ts/services/backups/constants.std.ts`
const BACKUP_VERSION = 1n;
const MS_PER_SECOND = 1000;
const DAY_MS = 24 * 60 * 60 * MS_PER_SECOND;
const MESSAGE_BATCH_SIZE = 1000;
// Signal Desktop `MINIMUM_LIFETIME` in `ts/services/backups/util/expiration.std.ts`
const MINIMUM_LIFETIME_MS = DAY_MS;
// The transit tier of the CDN keeps attachments for this long on the free tier (Signal Android `RestoreAttachmentJob`)
const FREE_TIER_MEDIA_DAYS = 45;
const ATTACHMENT_KEY_LENGTH = 64;
const DIGEST_LENGTH = 32;
const MAX_SAFE_MUTE_MS = Number.MAX_SAFE_INTEGER;
const INT64_MAX = 2n ** 63n - 1n;
const PIN_ORDER_OFFSET = 1;
const INITIAL_EXPIRE_TIMER_VERSION = 1;
const PNI_BINARY_PREFIX = 1;
const PNI_PREFIX = 'PNI:';
const E164_PLUS = /^\+/;

const GROUP_ACCESS: Record<number, Group_AccessControl_AccessRequired> = {
  0: Group_AccessControl_AccessRequired.UNKNOWN,
  1: Group_AccessControl_AccessRequired.ANY,
  2: Group_AccessControl_AccessRequired.MEMBER,
  3: Group_AccessControl_AccessRequired.ADMINISTRATOR,
  4: Group_AccessControl_AccessRequired.UNSATISFIABLE,
};
const BODY_RANGE_STYLES: Record<number, BackupBodyRangeStyle | undefined> = {
  [BodyRange_Style.NONE]: undefined,
  [BodyRange_Style.BOLD]: BackupBodyRangeStyle.BOLD,
  [BodyRange_Style.ITALIC]: BackupBodyRangeStyle.ITALIC,
  [BodyRange_Style.SPOILER]: BackupBodyRangeStyle.SPOILER,
  [BodyRange_Style.STRIKETHROUGH]: BackupBodyRangeStyle.STRIKETHROUGH,
  [BodyRange_Style.MONOSPACE]: BackupBodyRangeStyle.MONOSPACE,
};
const ATTACHMENT_FLAGS: Record<number, MessageAttachment_Flag | undefined> = {
  [AttachmentPointer_Flags.VOICE_MESSAGE]: MessageAttachment_Flag.VOICE_MESSAGE,
  [AttachmentPointer_Flags.BORDERLESS]: MessageAttachment_Flag.BORDERLESS,
  [AttachmentPointer_Flags.GIF]: MessageAttachment_Flag.GIF,
};
const PHONE_TYPES: Record<number, BackupPhoneType | undefined> = {
  [PhoneType.HOME]: BackupPhoneType.HOME,
  [PhoneType.MOBILE]: BackupPhoneType.MOBILE,
  [PhoneType.WORK]: BackupPhoneType.WORK,
  [PhoneType.CUSTOM]: BackupPhoneType.CUSTOM,
};
const EMAIL_TYPES: Record<number, BackupEmailType | undefined> = {
  [EmailType.HOME]: BackupEmailType.HOME,
  [EmailType.MOBILE]: BackupEmailType.MOBILE,
  [EmailType.WORK]: BackupEmailType.WORK,
  [EmailType.CUSTOM]: BackupEmailType.CUSTOM,
};
const ADDRESS_TYPES: Record<number, BackupAddressType | undefined> = {
  [AddressType.HOME]: BackupAddressType.HOME,
  [AddressType.WORK]: BackupAddressType.WORK,
  [AddressType.CUSTOM]: BackupAddressType.CUSTOM,
};
const IDENTITY_STATES: Record<number, Contact_IdentityState | undefined> = {
  [Verified_State.DEFAULT]: Contact_IdentityState.DEFAULT,
  [Verified_State.VERIFIED]: Contact_IdentityState.VERIFIED,
  [Verified_State.UNVERIFIED]: Contact_IdentityState.UNVERIFIED,
};
const DAYS_OF_WEEK: Record<number, NotificationProfile_DayOfWeek | undefined> = {
  1: NotificationProfile_DayOfWeek.MONDAY,
  2: NotificationProfile_DayOfWeek.TUESDAY,
  3: NotificationProfile_DayOfWeek.WEDNESDAY,
  4: NotificationProfile_DayOfWeek.THURSDAY,
  5: NotificationProfile_DayOfWeek.FRIDAY,
  6: NotificationProfile_DayOfWeek.SATURDAY,
  7: NotificationProfile_DayOfWeek.SUNDAY,
};

/**
 * Builds the frames of a remote backup from the local data (Signal Desktop `BackupExportStream` in
 * `ts/services/backups/export.preload.ts` with the content policy `remote` of `ts/services/backups/policy.std.ts`):
 * the account data, the recipients (ourselves, contacts, groups with their state, distribution lists and the release
 * notes), installed sticker packs, chats with their settings, chat folders and notification profiles from the
 * storage service records, and the chat items in arrival order. A recipient that only a chat item mentions comes
 * just before that item. Calls, payments, gift badges and stories are not stored, and so not exported.
 */
export function createBackupExport(options: ExportOptions): BackupExport {
  const exporter = new BackupExporter(options);
  return { info: exporter.buildInfo(), frames: exporter.run(), stats: exporter.stats };
}

class BackupExporter {
  readonly stats: BackupExportStats = {
    contacts: 0, groups: 0, chats: 0, chatItems: 0, skipped: {},
  };

  // The recipient of a conversation, which is also the id of its chat; the key is the conversation id
  private recipientIds = new Map<string, bigint>();

  private nextRecipientId = 1n;

  private pendingRecipients: Frame[] = [];

  private conversations = new Map<string, ConversationRecord>();

  private chatIds = new Set<string>();

  private now = getServerTime() * MS_PER_SECOND;

  constructor(private options: ExportOptions) {}

  buildInfo() {
    return toBinary(BackupInfoSchema, create(BackupInfoSchema, {
      version: BACKUP_VERSION,
      backupTimeMs: BigInt(this.now),
      mediaRootBackupKey: this.options.account.mediaRootBackupKey!,
      currentAppVersion: this.options.appVersion,
    }));
  }

  async* run(): AsyncGenerator<Frame> {
    const { store, account } = this.options;
    const conversations = (await this.options.db.getConversations()).sort((a, b) => a.localId - b.localId);
    for (const conversation of conversations) this.conversations.set(conversation.id, conversation);

    yield frame({ case: 'account', value: this.buildAccountData() });

    const selfId = this.takeRecipientId();
    this.recipientIds.set(account.aci, selfId);
    yield frame({ case: 'recipient', value: { id: selfId, destination: { case: 'self', value: create(SelfSchema) } } });

    for (const conversation of conversations) {
      if (conversation.id !== account.aci) yield* this.exportConversationRecipient(conversation);
    }
    yield frame({
      case: 'recipient',
      value: { id: this.takeRecipientId(), destination: { case: 'releaseNotes', value: create(ReleaseNotesSchema) } },
    });
    yield* this.exportDistributionLists(await store.getItem('storyDistributionLists') ?? []);
    yield* this.drainPendingRecipients();

    for (const pack of sortInstalledStickerPacks(Object.values(await store.getItem('stickerPacks') ?? {}))) {
      yield frame({
        case: 'installedStickerPack', value: { packId: bufferFromHex(pack.id), packKey: bufferFromHex(pack.key) },
      });
    }

    yield* this.exportChats();
    yield* this.exportStorageRecords();
    yield* this.exportChatItems();
  }

  private takeRecipientId() {
    return this.nextRecipientId++;
  }

  private buildAccountData(): MessageInitShape<typeof AccountDataSchema> {
    const { account, backupTier } = this.options;
    const self = this.conversations.get(account.aci);
    return {
      profileKey: account.profileKey,
      username: self?.username,
      usernameLink: account.usernameLink && self?.username
        ? { entropy: account.usernameLink.entropy, serverId: uuidToBytes(account.usernameLink.serverId) } : undefined,
      givenName: self?.profileName,
      familyName: self?.profileFamilyName,
      avatarUrlPath: self?.avatarPath,
      bioText: self?.about,
      bioEmoji: self?.aboutEmoji,
      accountSettings: {
        readReceipts: Boolean(account.isReadReceiptsEnabled),
        sealedSenderIndicators: Boolean(account.isSealedSenderIndicatorsEnabled),
        typingIndicators: Boolean(account.isTypingIndicatorsEnabled),
        linkPreviews: Boolean(account.isLinkPreviewsEnabled),
        notDiscoverableByPhoneNumber: Boolean(account.isPhoneNumberUnlisted),
        universalExpireTimerSeconds: account.universalExpireTimer ?? 0,
        storiesDisabled: Boolean(account.isStoriesDisabled),
        storyViewReceiptsEnabled: account.isStoryViewReceiptsEnabled,
        phoneNumberSharingMode: account.isPhoneNumberShared
          ? AccountData_PhoneNumberSharingMode.EVERYBODY : AccountData_PhoneNumberSharingMode.NOBODY,
        backupTier: backupTier !== undefined ? BigInt(backupTier) : undefined,
        defaultChatStyle: buildBackupChatStyle(account.defaultChatStyle),
        customChatColors: buildBackupCustomChatColors(account.customChatColors),
        allowAutomaticKeyVerification: true,
        // The validator wants these enums to have a known value
        defaultSentMediaQuality: AccountData_SentMediaQuality.STANDARD,
        appTheme: AccountData_AppTheme.SYSTEM,
        callsUseLessDataSetting: AccountData_CallsUseLessDataSetting.MOBILE_DATA_ONLY,
        unreadBadgeType: AccountData_AccountSettings_UnreadBadgeType.UNREAD_MESSAGES,
      },
    };
  }

  private async* exportConversationRecipient(conversation: ConversationRecord): AsyncGenerator<Frame> {
    if (conversation.type === 'private') {
      const id = this.takeRecipientId();
      this.recipientIds.set(conversation.id, id);
      this.stats.contacts++;
      yield frame({ case: 'recipient', value: { id, destination: await this.buildContact(conversation) } });
      return;
    }

    if (!conversation.masterKey?.length) {
      this.skip('groupWithoutMasterKey');
      return;
    }
    // The members come first: each gets a contact of its own that carries its profile key
    for (const member of conversation.groupState?.members ?? []) await this.ensureContactRecipient(member.aci, member);
    yield* this.drainPendingRecipients();

    const id = this.takeRecipientId();
    this.recipientIds.set(conversation.id, id);
    this.stats.groups++;
    yield frame({ case: 'recipient', value: { id, destination: this.buildGroup(conversation) } });
  }

  private async buildContact(conversation: ConversationRecord): Promise<RecipientInit['destination']> {
    const { store, account } = this.options;
    const known = await store.getRecipient(conversation.id);
    const identity = await store.getIdentity(conversation.id);
    const e164 = conversation.e164 ?? known?.number;
    return {
      case: 'contact',
      value: {
        aci: uuidToBytes(conversation.id),
        pni: known?.pni ? uuidToBytes(known.pni) : undefined,
        e164: e164 ? BigInt(e164.replace(E164_PLUS, '')) : undefined,
        username: conversation.username,
        blocked: Boolean(conversation.isBlocked),
        registration: { case: 'registered', value: create(Contact_RegisteredSchema) },
        profileKey: known?.profileKey,
        profileSharing: getIsConversationAccepted(conversation, account.aci),
        profileGivenName: conversation.profileName,
        profileFamilyName: conversation.profileFamilyName,
        hideStory: Boolean(conversation.isStoryHidden),
        identityKey: identity?.publicKey,
        identityState: IDENTITY_STATES[identity?.verified ?? Verified_State.DEFAULT],
        nickname: conversation.nickname ? { given: conversation.nickname } : undefined,
        systemGivenName: conversation.systemName,
      },
    };
  }

  private buildGroup(conversation: ConversationRecord): RecipientInit['destination'] {
    const state: GroupState | undefined = conversation.groupState;
    const { account } = this.options;
    return {
      case: 'group',
      value: {
        masterKey: conversation.masterKey,
        whitelisted: getIsConversationAccepted(conversation, account.aci),
        hideStory: Boolean(conversation.isStoryHidden),
        blocked: Boolean(conversation.isBlocked),
        snapshot: {
          title: { content: { case: 'title', value: conversation.title?.trim() ?? '' } },
          description: conversation.description !== undefined
            ? { content: { case: 'descriptionText', value: conversation.description.trim() } } : undefined,
          avatarUrl: conversation.avatarPath,
          disappearingMessagesTimer: conversation.expireTimer
            ? { content: { case: 'disappearingMessagesDuration', value: conversation.expireTimer } } : undefined,
          accessControl: state && {
            attributes: GROUP_ACCESS[state.accessControl.attributes],
            members: GROUP_ACCESS[state.accessControl.members],
            addFromInviteLink: GROUP_ACCESS[state.accessControl.addFromInviteLink],
            memberLabel: GROUP_ACCESS[state.accessControl.memberLabel],
          },
          version: conversation.revision ?? 0,
          members: (state?.members ?? []).map((member) => buildGroupMember(member)),
          membersPendingProfileKey: (state?.pendingMembers ?? []).flatMap((member) => (member.addedBy ? [{
            member: { userId: serviceIdToBytes(member.serviceId), role: member.role as number },
            addedByUserId: uuidToBytes(member.addedBy),
            timestamp: BigInt(member.timestamp ?? 0),
          }] : [])),
          membersPendingAdminApproval: (state?.requestingMembers ?? []).map((member) => ({
            userId: uuidToBytes(member.aci), timestamp: BigInt(member.timestamp ?? 0),
          })),
          membersBanned: (state?.bannedMembers ?? []).map((member) => ({
            userId: serviceIdToBytes(member.serviceId), timestamp: BigInt(member.timestamp ?? 0),
          })),
          inviteLinkPassword: state?.inviteLinkPassword,
          announcementsOnly: Boolean(conversation.isAnnouncementsOnly),
          terminated: Boolean(state?.isTerminated),
        },
      },
    };
  }

  /** The recipient of an ACI; one that no conversation made has a bare contact, sent before its first use */
  private async ensureContactRecipient(aci: string, member?: Pick<GroupMember, 'profileKey'>) {
    const existing = this.recipientIds.get(aci);
    if (existing !== undefined) return existing;

    const { store } = this.options;
    const id = this.takeRecipientId();
    this.recipientIds.set(aci, id);
    const known = await store.getRecipient(aci);
    const identity = await store.getIdentity(aci);
    this.stats.contacts++;
    this.pendingRecipients.push(frame({
      case: 'recipient',
      value: {
        id,
        destination: {
          case: 'contact',
          value: {
            aci: uuidToBytes(aci),
            pni: known?.pni ? uuidToBytes(known.pni) : undefined,
            e164: known?.number ? BigInt(known.number.replace(E164_PLUS, '')) : undefined,
            registration: { case: 'registered', value: create(Contact_RegisteredSchema) },
            profileKey: known?.profileKey ?? member?.profileKey,
            identityKey: identity?.publicKey,
            identityState: IDENTITY_STATES[identity?.verified ?? Verified_State.DEFAULT],
          },
        },
      },
    }));
    return id;
  }

  private ensureContactOrSelf(aci: string) {
    return this.recipientIds.get(aci) ?? this.ensureContactRecipient(aci);
  }

  private* drainPendingRecipients() {
    const pending = this.pendingRecipients;
    this.pendingRecipients = [];
    yield* pending;
  }

  private async* exportDistributionLists(lists: StoryDistributionList[]): AsyncGenerator<Frame> {
    for (const list of lists) {
      let item: Extract<RecipientInit['destination'], { case: 'distributionList' }>['value']['item'];
      if (list.deletedAt) {
        item = { case: 'deletionTimestamp', value: BigInt(list.deletedAt) };
      } else {
        const memberRecipientIds: bigint[] = [];
        for (const aci of list.memberAcis) memberRecipientIds.push(await this.ensureContactOrSelf(aci));
        item = {
          case: 'distributionList',
          value: {
            name: list.name,
            allowReplies: list.areRepliesAllowed,
            privacyMode: getPrivacyMode(list),
            memberRecipientIds,
          },
        };
      }
      yield* this.drainPendingRecipients();
      yield frame({
        case: 'recipient',
        value: {
          id: this.takeRecipientId(),
          destination: { case: 'distributionList', value: { distributionId: uuidToBytes(list.id), item } },
        },
      });
    }
  }

  private* exportChats() {
    for (const conversation of this.conversations.values()) {
      const recipientId = this.recipientIds.get(conversation.id);
      if (recipientId === undefined || !getHasChat(conversation)) continue;

      this.chatIds.add(conversation.id);
      this.stats.chats++;
      yield frame({
        case: 'chat',
        value: {
          id: recipientId,
          recipientId,
          archived: Boolean(conversation.isArchived),
          pinnedOrder: conversation.pinIndex !== undefined ? conversation.pinIndex + PIN_ORDER_OFFSET : undefined,
          expirationTimerMs: conversation.expireTimer ? BigInt(conversation.expireTimer * MS_PER_SECOND) : undefined,
          // A timer without a version is a timer that was never changed since the versions began
          expireTimerVersion: conversation.expireTimerVersion
            ?? (conversation.expireTimer ? INITIAL_EXPIRE_TIMER_VERSION : 0),
          muteUntilMs: getMuteUntil(conversation.mutedUntil, this.now),
          markedUnread: Boolean(conversation.isMarkedUnread),
          style: buildBackupChatStyle(conversation.chatStyle),
        },
      });
    }
  }

  /** Chat folders and notification profiles are kept only as the storage service records that carry them */
  private async* exportStorageRecords(): AsyncGenerator<Frame> {
    const { store } = this.options;
    const manifest = await store.getItem('storageManifest');
    if (!manifest) return;
    const ids = fromBinary(ManifestRecordSchema, manifest).identifiers.map(({ raw }) => bufferToBase64(raw));
    const records = (await store.getStorageRecords(ids))
      .filter((raw) => raw !== undefined)
      .map((raw) => fromBinary(StorageRecordSchema, raw));

    const folders = records
      .flatMap(({ record }) => (record.case === 'chatFolder' ? [record.value] : []))
      .filter(({ deletedAtTimestampMs }) => !deletedAtTimestampMs)
      .sort((a, b) => a.position - b.position);
    const folderFrames: Frame[] = [];
    for (const folder of folders) folderFrames.push(frame({ case: 'chatFolder', value: this.buildChatFolder(folder) }));
    // A backup with chat folders has exactly one folder of all chats (libsignal `CompletionError`)
    const allFolderCount = folders.filter(({ folderType }) => folderType === ChatFolderRecord_FolderType.ALL).length;
    if (allFolderCount === 1) {
      yield* this.drainPendingRecipients();
      yield* folderFrames;
    }

    for (const { record } of records) {
      if (record.case !== 'notificationProfile' || record.value.deletedAtTimestampMs) continue;
      yield frame({ case: 'notificationProfile', value: this.buildNotificationProfile(record.value) });
    }
  }

  private buildChatFolder(folder: ChatFolderRecord) {
    const isAll = folder.folderType === ChatFolderRecord_FolderType.ALL;
    return {
      id: folder.identifier,
      name: folder.name,
      showOnlyUnread: folder.showOnlyUnread,
      // The folder of all chats shows everything (libsignal `ChatFolder`)
      showMutedChats: isAll || folder.showMutedChats,
      includeAllIndividualChats: isAll || folder.includeAllIndividualChats,
      includeAllGroupChats: isAll || folder.includeAllGroupChats,
      folderType: isAll ? ChatFolder_FolderType.ALL : ChatFolder_FolderType.CUSTOM,
      includedRecipientIds: this.getStorageRecipientIds(folder.includedRecipients),
      excludedRecipientIds: this.getStorageRecipientIds(folder.excludedRecipients),
    };
  }

  private buildNotificationProfile(profile: StorageNotificationProfile) {
    const selfId = this.recipientIds.get(this.options.account.aci);
    return {
      id: profile.id,
      name: profile.name,
      emoji: profile.emoji,
      color: profile.color,
      createdAtMs: profile.createdAtMs,
      allowAllCalls: profile.allowAllCalls,
      allowAllMentions: profile.allowAllMentions,
      // The profile may not list ourselves
      allowedMembers: this.getStorageRecipientIds(profile.allowedMembers).filter((id) => id !== selfId),
      scheduleEnabled: profile.scheduleEnabled,
      scheduleStartTime: profile.scheduleStartTime,
      scheduleEndTime: profile.scheduleEndTime,
      scheduleDaysEnabled: profile.scheduleDaysEnabled.flatMap((day) => DAYS_OF_WEEK[day] ?? []),
    };
  }

  /** The recipient ids of storage service recipients that are conversations here: contacts and groups */
  private getStorageRecipientIds(recipients: StorageRecipient[]) {
    return recipients.flatMap(({ identifier }) => {
      let conversationId: string | undefined;
      if (identifier.case === 'contact') conversationId = identifier.value.serviceId;
      if (identifier.case === 'groupMasterKey') conversationId = getGroupId(identifier.value);
      const id = conversationId ? this.recipientIds.get(conversationId) : undefined;
      return id !== undefined ? [id] : [];
    });
  }

  private async* exportChatItems(): AsyncGenerator<Frame> {
    const pins = new Map<number, { pinnedAt: number; expiresAt?: number }>();
    for (const conversation of this.conversations.values()) {
      for (const { messageId, pinnedAt, expiresAt } of conversation.pinnedMessages ?? []) {
        pins.set(messageId, { pinnedAt, expiresAt });
      }
    }

    let afterId = 0;
    for (;;) {
      const messages = await this.options.db.getMessagesAfter(afterId, MESSAGE_BATCH_SIZE);
      if (!messages.length) return;
      afterId = messages[messages.length - 1].id;

      for (const message of messages) {
        const item = await this.buildChatItem(message, pins.get(message.id));
        if (!item) continue;
        // A recipient that this item mentions first is sent before the item
        yield* this.drainPendingRecipients();
        this.stats.chatItems++;
        yield frame({ case: 'chatItem', value: item });
      }
    }
  }

  private async buildChatItem(
    message: MessageRecord, pin?: { pinnedAt: number; expiresAt?: number },
  ): Promise<ChatItemInit | undefined> {
    const { account } = this.options;
    const conversation = this.conversations.get(message.conversationId);
    const chatId = conversation && this.chatIds.has(conversation.id)
      ? this.recipientIds.get(conversation.id) : undefined;
    if (!conversation || chatId === undefined) {
      this.skip('messageWithoutChat');
      return undefined;
    }

    if (this.options.messageCutoffMs !== undefined && message.sentAt < this.options.messageCutoffMs) {
      this.skip('olderThanCutoff');
      return undefined;
    }
    const expireTimerMs = message.expireTimer ? message.expireTimer * MS_PER_SECOND : undefined;
    if (!getCanExport(expireTimerMs, message.expiresAt, this.now)) {
      this.skip('shortLived');
      return undefined;
    }
    const base = {
      chatId,
      dateSent: BigInt(message.editedAt ?? message.sentAt),
      expiresInMs: expireTimerMs !== undefined ? BigInt(expireTimerMs) : undefined,
      expireStartDate: expireTimerMs !== undefined && message.expiresAt !== undefined
        ? BigInt(message.expiresAt - expireTimerMs) : undefined,
    };
    const selfId = this.recipientIds.get(account.aci)!;

    if (message.kind !== 'message') return this.buildNotice(message, conversation, base, selfId);

    const authorId = message.isOutgoing ? selfId : await this.ensureContactOrSelf(message.authorAci);
    // A direct chat holds the messages of ourselves and of the contact only
    if (conversation.type === 'private' && authorId !== selfId && authorId !== chatId) {
      this.skip('messageOfAnotherAuthor');
      return undefined;
    }

    const item = await this.buildContent(message);
    if (typeof item === 'string') {
      this.skip(item);
      return undefined;
    }
    const directionalDetails: ChatItemInit['directionalDetails'] = message.isOutgoing
      ? { case: 'outgoing', value: await this.buildOutgoingDetails(message, conversation) }
      : {
        case: 'incoming',
        value: {
          dateReceived: BigInt(message.receivedAt),
          dateServerSent: message.serverTimestamp !== undefined ? BigInt(message.serverTimestamp) : undefined,
          read: Boolean(message.readAt),
          sealedSender: Boolean(message.isSealedSender),
        },
      };

    // Earlier versions of an edited message, oldest first, each with the content it had
    const revisions: ChatItemInit[] = [];
    for (const revision of message.revisions ?? []) {
      const revisionItem = await this.buildContent({
        ...message, dataMessage: revision.dataMessage, reactions: undefined,
      });
      if (typeof revisionItem === 'string') continue;
      revisions.push({
        ...base, authorId, dateSent: BigInt(revision.editedAt), directionalDetails, item: revisionItem,
      });
    }

    return {
      ...base,
      authorId,
      directionalDetails,
      item,
      revisions,
      pinDetails: pin ? {
        pinnedAtTimestamp: BigInt(pin.pinnedAt),
        pinExpiry: pin.expiresAt !== undefined
          ? { case: 'pinExpiresAtTimestamp', value: BigInt(pin.expiresAt) } : { case: 'pinNeverExpires', value: true },
      } : undefined,
    };
  }

  private async buildOutgoingDetails(message: MessageRecord, conversation: ConversationRecord) {
    const sendStatus: MessageInitShape<typeof SendStatusSchema>[] = [];
    const isSealedSender = Boolean(message.isSealedSender);
    for (const [aci, status] of Object.entries(message.recipientStatus ?? {})) {
      // Our other devices are no recipients, except in Note to Self
      if (aci === this.options.account.aci && conversation.id !== aci) continue;
      const recipientId = await this.ensureContactOrSelf(aci);
      const timestamp = BigInt(message.sentAt);
      let deliveryStatus: MessageInitShape<typeof SendStatusSchema>['deliveryStatus'];
      switch (status) {
        case 'pending':
          deliveryStatus = { case: 'pending', value: create(SendStatus_PendingSchema) };
          break;
        case 'failed':
          deliveryStatus = { case: 'failed', value: { reason: getFailureReason(message.recipientErrors?.[aci]) } };
          break;
        default:
          deliveryStatus = { case: status, value: { sealedSender: isSealedSender } };
      }
      sendStatus.push({ recipientId, timestamp, deliveryStatus });
    }
    return { sendStatus, dateReceived: BigInt(message.receivedAt) };
  }

  /** The item of a message; a string is the reason that the message has no place in the backup */
  private async buildContent(message: MessageRecord): Promise<ChatItemInit['item'] | string> {
    if (!message.dataMessage) {
      if (message.deletedAt === undefined) return 'messageWithoutContent';
      return message.deletedByAdminAci
        ? { case: 'adminDeletedMessage', value: { adminId: await this.ensureContactOrSelf(message.deletedByAdminAci) } }
        : { case: 'remoteDeletedMessage', value: create(RemoteDeletedMessageSchema) };
    }

    const data = fromBinary(DataMessageSchema, message.dataMessage);
    const reactions = await this.buildReactions(message);
    if (data.pollCreate) return { case: 'poll', value: await this.buildPoll(message, data, reactions) };
    // A remote backup never holds the attachment of a view-once message
    if (data.isViewOnce) return { case: 'viewOnceMessage', value: { reactions } };
    if (data.sticker?.packId.length) {
      const { packId, packKey, stickerId, emoji, data: pointer } = data.sticker;
      return {
        case: 'stickerMessage',
        value: {
          sticker: {
            packId, packKey, stickerId, emoji: emoji || undefined, data: pointer && this.buildFilePointer(pointer),
          },
          reactions,
        },
      };
    }
    if (data.contact.length) {
      return { case: 'contactMessage', value: { contact: this.buildContactAttachment(data.contact[0]), reactions } };
    }
    return this.buildStandardMessage(message, data, reactions);
  }

  private async buildStandardMessage(
    message: MessageRecord, data: DataMessage, reactions: ReactionInit[],
  ): Promise<ChatItemInit['item'] | string> {
    const longText = data.attachments.find(({ contentType }) => contentType === LONG_TEXT_CONTENT_TYPE);
    const attachments = data.attachments
      .map((attachment, index) => ({ attachment, index }))
      .filter(({ attachment }) => attachment !== longText)
      .map(({ attachment, index }) => (
        this.buildMessageAttachment(attachment, message.unavailableAttachmentIndexes?.includes(index))
      ));
    const text = data.body ? { body: data.body, bodyRanges: await this.buildBodyRanges(data.bodyRanges) } : undefined;
    if (!text && !attachments.length && !longText) return 'standardMessageWithoutContent';

    return {
      case: 'standardMessage',
      value: {
        quote: data.quote ? await this.buildQuote(data.quote) : undefined,
        text,
        attachments,
        linkPreview: data.preview.map((preview) => ({
          url: preview.url,
          title: preview.title || undefined,
          description: preview.description || undefined,
          date: preview.date ? BigInt(preview.date) : undefined,
          image: preview.image && this.buildFilePointer(preview.image),
        })),
        longText: longText && this.buildFilePointer(longText),
        reactions,
      },
    };
  }

  private async buildReactions(message: MessageRecord) {
    const reactions: ReactionInit[] = [];
    for (const [index, { emoji, authorAci, sentAt }] of (message.reactions ?? []).entries()) {
      reactions.push({
        emoji,
        authorId: await this.ensureContactOrSelf(authorAci),
        sentTimestamp: BigInt(sentAt),
        sortOrder: BigInt(index + 1),
      });
    }
    return reactions;
  }

  private async buildPoll(message: MessageRecord, data: DataMessage, reactions: ReactionInit[]) {
    const { question, allowMultiple, options } = data.pollCreate!;
    const pollOptions = [];
    for (const [index, option] of options.entries()) {
      const votes = [];
      for (const vote of message.pollVotes ?? []) {
        if (vote.optionIndexes.includes(index)) {
          votes.push({ voterId: await this.ensureContactOrSelf(vote.authorAci), voteCount: vote.voteCount || 1 });
        }
      }
      pollOptions.push({ option, votes });
    }
    return {
      question, allowMultiple, hasEnded: Boolean(message.isPollEnded), options: pollOptions, reactions,
    };
  }

  private async buildQuote(quote: NonNullable<DataMessage['quote']>) {
    const aci = quote.authorAci || (quote.authorAciBinary.length ? uuidToString(quote.authorAciBinary) : '');
    if (!aci) return undefined;
    let type = Quote_Type.NORMAL;
    if (quote.type === DataMessage_Quote_Type.GIFT_BADGE) type = Quote_Type.GIFT_BADGE;
    if (quote.type === DataMessage_Quote_Type.POLL) type = Quote_Type.POLL;
    if (type === Quote_Type.NORMAL && !quote.text && !quote.attachments.length) return undefined;

    return {
      targetSentTimestamp: quote.id ? quote.id : undefined,
      authorId: await this.ensureContactOrSelf(aci),
      text: quote.text ? { body: quote.text, bodyRanges: await this.buildBodyRanges(quote.bodyRanges) } : undefined,
      attachments: quote.attachments.map(({ contentType, fileName, thumbnail }) => ({
        contentType: contentType || undefined,
        fileName: fileName || undefined,
        thumbnail: thumbnail && this.buildMessageAttachment(thumbnail),
      })),
      type,
    };
  }

  private async buildBodyRanges(ranges: BodyRange[]) {
    const result = [];
    for (const { start, length, associatedValue } of ranges) {
      if (associatedValue.case === 'mentionAci' || associatedValue.case === 'mentionAciBinary') {
        const aci = associatedValue.case === 'mentionAci' ? associatedValue.value : uuidToString(associatedValue.value);
        await this.ensureContactOrSelf(aci);
        result.push({ start, length, associatedValue: { case: 'mentionAci' as const, value: uuidToBytes(aci) } });
      } else if (associatedValue.case === 'style') {
        const style = BODY_RANGE_STYLES[associatedValue.value];
        if (style) result.push({ start, length, associatedValue: { case: 'style' as const, value: style } });
      }
    }
    return result;
  }

  private buildMessageAttachment(attachment: AttachmentPointer, isUnavailable?: boolean) {
    return {
      pointer: this.buildFilePointer(attachment, isUnavailable),
      flag: ATTACHMENT_FLAGS[attachment.flags] ?? MessageAttachment_Flag.NONE,
      clientUuid: attachment.clientUuid.length ? attachment.clientUuid : undefined,
    };
  }

  private buildContactAttachment({
    name, number, email, address, avatar, organization, aciBinary, nickname, note,
  }: DataMessage_Contact) {
    const hasName = name && [
      name.givenName, name.familyName, name.prefix, name.suffix, name.middleName, name.nickname,
    ].some(Boolean);
    return {
      name: hasName ? {
        givenName: name.givenName,
        familyName: name.familyName,
        prefix: name.prefix,
        suffix: name.suffix,
        middleName: name.middleName,
        nickname: name.nickname,
      } : undefined,
      number: number.map(({ value, type, label }) => ({
        value, label, type: PHONE_TYPES[type] ?? BackupPhoneType.HOME,
      })),
      email: email.map(({ value, type, label }) => ({ value, label, type: EMAIL_TYPES[type] ?? BackupEmailType.HOME })),
      address: address.map(({
        type, label, street, pobox, neighborhood, city, region, postcode, country,
      }) => ({
        type: ADDRESS_TYPES[type] ?? BackupAddressType.HOME,
        label,
        street,
        pobox,
        neighborhood,
        city,
        region,
        postcode,
        country,
      })),
      avatar: avatar?.avatar && this.buildFilePointer(avatar.avatar),
      organization,
      aci: aciBinary,
      nickname: nickname && (nickname.given || nickname.family)
        ? { given: nickname.given, family: nickname.family } : undefined,
      note,
    };
  }

  /**
   * The transit tier locator of an attachment, which a restore downloads from the CDN with its key and digest
   * (Signal Desktop `getFilePointerForAttachment` in `ts/services/backups/util/filePointers.preload.ts`). The free
   * tier of Signal Secure Backups keeps no media: attachments that the CDN still holds, which are those uploaded
   * within `FREE_TIER_MEDIA_DAYS`, are restorable and the others get an empty locator, which a restore shows as an
   * attachment that is not available.
   */
  private buildFilePointer(attachment: AttachmentPointer, isUnavailable?: boolean) {
    const { attachmentIdentifier } = attachment;
    const cdnKey = attachmentIdentifier.case === 'cdnKey' ? attachmentIdentifier.value : undefined;
    const uploadedAt = Number(attachment.uploadTimestamp);
    const hasKeys = attachment.key.length === ATTACHMENT_KEY_LENGTH && attachment.digest.length === DIGEST_LENGTH;
    // An attachment without an upload time is not known to be on the CDN
    const isOnCdn = !isUnavailable && hasKeys && Boolean(cdnKey) && Boolean(uploadedAt)
      && this.now - uploadedAt < FREE_TIER_MEDIA_DAYS * DAY_MS;

    return {
      contentType: attachment.contentType || undefined,
      fileName: attachment.fileName || undefined,
      width: attachment.width || undefined,
      height: attachment.height || undefined,
      caption: attachment.caption || undefined,
      blurHash: attachment.blurHash || undefined,
      audioWaveform: attachment.audioWaveform.length ? attachment.audioWaveform : undefined,
      audioDurationSeconds: attachment.audioDurationSeconds || undefined,
      locatorInfo: isOnCdn ? {
        key: attachment.key,
        size: attachment.size,
        integrityCheck: { case: 'encryptedDigest' as const, value: attachment.digest },
        transitCdnKey: cdnKey,
        transitCdnNumber: attachment.cdnNumber,
        transitTierUploadTimestamp: uploadedAt ? BigInt(uploadedAt) : undefined,
      } : {},
    };
  }

  /** Timer changes, group notices and safety number notices, which have no direction in the format */
  private async buildNotice(
    message: MessageRecord, conversation: ConversationRecord, base: ChatItemInit, selfId: bigint,
  ): Promise<ChatItemInit | undefined> {
    const { account } = this.options;
    const toItem = async (update: UpdateInit['update'], authorAci?: string): Promise<ChatItemInit> => ({
      ...base,
      authorId: authorAci ? await this.ensureContactOrSelf(authorAci) : selfId,
      directionalDetails: { case: 'directionless', value: create(ChatItem_DirectionlessMessageDetailsSchema) },
      item: { case: 'updateMessage', value: create(ChatUpdateMessageSchema, { update }) },
    });

    switch (message.kind) {
      case 'timerUpdate': {
        const expiresInMs = BigInt((message.expireTimer ?? 0) * MS_PER_SECOND);
        if (conversation.type === 'private') {
          const actorAci = message.actorAci ?? (message.isOutgoing ? account.aci : conversation.id);
          return toItem({ case: 'expirationTimerChange', value: { expiresInMs } }, actorAci);
        }
        const updaterAci = message.actorAci ? uuidToBytes(message.actorAci) : undefined;
        return toItem({
          case: 'groupChange',
          value: { updates: [{ update: { case: 'groupExpirationTimerUpdate', value: { expiresInMs, updaterAci } } }] },
        });
      }
      case 'groupUpdate': {
        if (!message.groupUpdate || conversation.type !== 'group') return undefined;
        const update = buildGroupUpdate(message.groupUpdate, message.actorAci);
        return toItem({ case: 'groupChange', value: { updates: [{ update }] } });
      }
      case 'safetyNumberChange':
        return toItem({
          case: 'simpleUpdate', value: { type: SimpleChatUpdate_Type.IDENTITY_UPDATE },
        }, message.actorAci);
      case 'verifiedChange':
        return toItem({
          case: 'simpleUpdate',
          value: {
            type: message.isVerified
              ? SimpleChatUpdate_Type.IDENTITY_VERIFIED : SimpleChatUpdate_Type.IDENTITY_DEFAULT,
          },
        }, message.actorAci);
      default:
        this.skip(`notice:${message.kind}`);
        return undefined;
    }
  }

  private skip(reason: string) {
    this.stats.skipped[reason] = (this.stats.skipped[reason] ?? 0) + 1;
  }
}

function frame(item: NonNullable<MessageInitShape<typeof FrameSchema>['item']>) {
  return create(FrameSchema, { item });
}

/** What a notice of the group history says, as the update of the backup that is closest to it */
function buildGroupUpdate(update: GroupUpdate, actorAci?: string): GroupUpdateInit {
  const updaterAci = actorAci ? uuidToBytes(actorAci) : undefined;
  switch (update.type) {
    case 'create':
      return { case: 'groupCreationUpdate', value: { updaterAci } };
    case 'title':
      return { case: 'groupNameUpdate', value: { updaterAci, newGroupName: update.title || undefined } };
    case 'avatar':
      return { case: 'groupAvatarUpdate', value: { updaterAci, wasRemoved: Boolean(update.isRemoved) } };
    case 'description':
      return { case: 'groupDescriptionUpdate', value: { updaterAci } };
    case 'membersAdded': {
      const [aci] = update.acis;
      if (update.acis.length === 1 && actorAci === aci) {
        return update.isFromInviteLink
          ? { case: 'groupMemberJoinedByLinkUpdate', value: { newMemberAci: uuidToBytes(aci) } }
          : { case: 'groupMemberJoinedUpdate', value: { newMemberAci: uuidToBytes(aci) } };
      }
      return update.acis.length === 1
        ? { case: 'groupMemberAddedUpdate', value: { updaterAci, newMemberAci: uuidToBytes(aci) } }
        : { case: 'genericGroupUpdate', value: { updaterAci } };
    }
    case 'memberRemoved':
      return actorAci === update.aci
        ? { case: 'groupMemberLeftUpdate', value: { aci: uuidToBytes(update.aci) } }
        : { case: 'groupMemberRemovedUpdate', value: { removerAci: updaterAci, removedAci: uuidToBytes(update.aci) } };
    case 'invited':
      return { case: 'groupUnknownInviteeUpdate', value: { inviterAci: updaterAci, inviteeCount: update.count } };
    case 'inviteDeclined':
      return { case: 'groupInvitationDeclinedUpdate', value: { inviteeAci: updaterAci } };
    case 'joinRequested':
      return updaterAci ? { case: 'groupJoinRequestUpdate', value: { requestorAci: updaterAci } }
        : { case: 'genericGroupUpdate', value: {} };
    case 'joinApproved':
      return {
        case: 'groupJoinRequestApprovalUpdate',
        value: { requestorAci: uuidToBytes(update.aci), updaterAci, wasApproved: true },
      };
    case 'joinDenied':
      return {
        case: 'groupJoinRequestApprovalUpdate',
        value: { requestorAci: uuidToBytes(update.aci), updaterAci, wasApproved: false },
      };
    case 'joinCanceled':
      return updaterAci ? { case: 'groupJoinRequestCanceledUpdate', value: { requestorAci: updaterAci } }
        : { case: 'genericGroupUpdate', value: {} };
    case 'adminChanged':
      return {
        case: 'groupAdminStatusUpdate',
        value: { updaterAci, memberAci: uuidToBytes(update.aci), wasAdminStatusGranted: update.isAdmin },
      };
    case 'access': {
      const accessLevel = update.isAdminOnly ? GroupV2AccessLevel.ADMINISTRATOR : GroupV2AccessLevel.MEMBER;
      if (update.target === 'info') {
        return { case: 'groupAttributesAccessLevelChangeUpdate', value: { updaterAci, accessLevel } };
      }
      if (update.target === 'members') {
        return { case: 'groupMembershipAccessLevelChangeUpdate', value: { updaterAci, accessLevel } };
      }
      return { case: 'groupMemberLabelAccessLevelChangeUpdate', value: { updaterAci, accessLevel } };
    }
    case 'inviteLink':
      if (update.state === 'off') return { case: 'groupInviteLinkDisabledUpdate', value: { updaterAci } };
      if (update.state === 'reset') return { case: 'groupInviteLinkResetUpdate', value: { updaterAci } };
      return {
        case: 'groupInviteLinkEnabledUpdate',
        value: { updaterAci, linkRequiresAdminApproval: update.state === 'onWithApproval' },
      };
    case 'announcementsOnly':
      return { case: 'groupAnnouncementOnlyChangeUpdate', value: { updaterAci, isAnnouncementOnly: update.isEnabled } };
    case 'terminated':
      return { case: 'groupTerminateChangeUpdate', value: { updaterAci } };
    default:
      // Revoked invitations name their invitees in the format, and the history keeps only their number
      return { case: 'genericGroupUpdate', value: { updaterAci } };
  }
}

function buildGroupMember({
  aci, role, joinedAtRevision, labelEmoji, label,
}: GroupMember) {
  return {
    userId: uuidToBytes(aci),
    role: (role ?? Group_Member_Role.DEFAULT) as Group_Member_Role,
    joinedAtVersion: joinedAtRevision ?? 0,
    labelEmoji,
    labelString: label,
  };
}

/** A service id as its binary form in the backup: an ACI is its 16 bytes, a PNI has a type byte in front */
function serviceIdToBytes(serviceId: string) {
  if (!serviceId.startsWith(PNI_PREFIX)) return uuidToBytes(serviceId);
  const pni = uuidToBytes(serviceId.slice(PNI_PREFIX.length));
  const bytes = new Uint8Array(pni.length + 1);
  bytes[0] = PNI_BINARY_PREFIX;
  bytes.set(pni, 1);
  return bytes;
}

/** Signal Desktop `export.preload.ts`: My Story is the one list whose privacy mode follows its exclusions */
function getPrivacyMode({ id, isBlockList, memberAcis }: StoryDistributionList) {
  if (id !== MY_STORY_ID) return DistributionList_PrivacyMode.ONLY_WITH;
  if (!isBlockList) return DistributionList_PrivacyMode.ONLY_WITH;
  return memberAcis.length ? DistributionList_PrivacyMode.ALL_EXCEPT : DistributionList_PrivacyMode.ALL;
}

/** A conversation has a chat once it has messages, a pin or settings of its own */
function getHasChat(conversation: ConversationRecord) {
  return conversation.lastMessageId !== undefined || conversation.pinIndex !== undefined
    || Boolean(
      conversation.isArchived || conversation.isMarkedUnread || conversation.mutedUntil || conversation.expireTimer,
    );
}

/** `INT64_MAX` mutes a chat for good; a mute that has run out is not exported */
function getMuteUntil(mutedUntil: number | undefined, now: number) {
  if (!mutedUntil) return undefined;
  if (mutedUntil >= MAX_SAFE_MUTE_MS) return INT64_MAX;
  return mutedUntil > now ? BigInt(mutedUntil) : undefined;
}

/**
 * A remote backup leaves out the messages that are gone within a day, as Signal Desktop
 * `canIncludeExpiringMessageInBackup` in `ts/services/backups/util/expiration.std.ts` does with `exclude-short-lived`
 */
function getCanExport(expireTimerMs: number | undefined, expiresAt: number | undefined, now: number) {
  if (expireTimerMs === undefined) return true;
  if (expireTimerMs <= MINIMUM_LIFETIME_MS) return false;
  return expiresAt === undefined || expiresAt > now + MINIMUM_LIFETIME_MS;
}

function getFailureReason(error?: SendErrorKind) {
  if (error === 'identityChanged') return SendStatus_Failed_FailureReason.IDENTITY_KEY_MISMATCH;
  if (error === 'network' || error === 'rateLimited') return SendStatus_Failed_FailureReason.NETWORK;
  return SendStatus_Failed_FailureReason.UNKNOWN;
}
