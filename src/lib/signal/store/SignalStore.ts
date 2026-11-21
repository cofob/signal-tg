import type { LastResortPreKeys } from '../account/preKeys';
import type { ChatStyleRecord, CustomChatColorRecord } from '../chatStyle/chatStyle';
import type { NotificationProfile, NotificationProfileOverride } from '../notificationProfiles/notificationProfiles';
import type { Verified_State } from '../proto/generated/SignalService_pb';
import type { StickerPackManifest, StickerPackRecord } from '../stickers/stickerPacks';
import type { StorageChanges } from '../storage/storageRecords';
import type { UsernameLink } from '../usernames/manageUsername';

import { IdbStore } from '../../../util/browser/idb';

export type KeyPairBytes = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export type AccountRecord = {
  aci: string;
  // Untagged PNI UUID, absent for accounts without a phone number
  pni?: string;
  number?: string;
  deviceId: number;
  // Linked devices only: a registered primary device has no name
  deviceName?: string;
  password: string;
  registrationId: number;
  pniRegistrationId: number;
  profileKey?: Uint8Array;
  accountEntropyPool?: string;
  masterKey?: Uint8Array;
  mediaRootBackupKey?: Uint8Array;
  ephemeralBackupKey?: Uint8Array;
  // Group auth credentials of accounts without a phone number (and so without a PNI) are bound to this salt
  authCredentialSalt?: Uint8Array;
  isReadReceiptsEnabled?: boolean;
  isTypingIndicatorsEnabled?: boolean;
  isLinkPreviewsEnabled?: boolean;
  isSealedSenderIndicatorsEnabled?: boolean;
  // The disappearing messages timer that new private chats start with, in seconds (`universalExpireTimer`)
  universalExpireTimer?: number;
  // The chat style that chats without one of their own use, and the custom chat colors, from the transferred history
  defaultChatStyle?: ChatStyleRecord;
  customChatColors?: Record<string, CustomChatColorRecord>;
  // Stories settings of the account record; view receipts follow read receipts until set
  isStoriesDisabled?: boolean;
  isStoryViewReceiptsEnabled?: boolean;
  // Phone number privacy, as in the storage service account record: who sees the number on our profile, and whether
  // people can find us by it. A primary device registered here sets the latter with the account attribute.
  isPhoneNumberShared?: boolean;
  isPhoneNumberUnlisted?: boolean;
  // Our username link (`AccountRecord.usernameLink`); the username is on our private conversation
  usernameLink?: UsernameLink;
  // Registered primary devices only: SVR2 stores the master key under a PIN
  hasSvrPin?: boolean;
  // Registered primary devices only: registering the number again needs the PIN
  isRegistrationLockEnabled?: boolean;
  // Registered primary devices only: storage service contacts with only a number are looked up with CDSI
  isContactDiscoveryEnabled?: boolean;
  // A registered account without its profile and one-time prekeys yet: registration resumes at the profile step
  isRegistrationPending?: boolean;
  // Set at registration until the user confirms to have saved the recovery key, which is the account entropy pool
  isRecoveryKeyUnconfirmed?: boolean;
  // The sync requests to the primary device after linking went out
  isInitialSyncDone?: boolean;
  // Seeded by `signalDev.seedDemo()` to check the UI without a phone: the client never connects
  isDemo?: boolean;
  // Set at linking when the primary device offers to transfer message history; removed once the transfer ends
  historyTransfer?: HistoryTransferState;
  // Signal Secure Backups of this account, see `backups/BackupService.ts`
  backups?: BackupSettings;
};

export type BackupFrequency = 'daily' | 'weekly' | 'monthly' | 'manual';

export type BackupSettings = {
  // Backups run on the schedule and the backup service holds the latest one
  isEnabled?: boolean;
  frequency?: BackupFrequency;
  // Milliseconds since the epoch on the server clock
  lastBackupAt?: number;
  lastRefreshAt?: number;
  // The size of the encrypted file of the last backup that went up
  lastBackupSize?: number;
  // The size of the frames before compression, which the next backup takes as its estimate
  uncompressedLength?: number;
  // The level of the backup credential: 200 is the free tier, 201 the paid one
  tier?: number;
  // The service refused the file as too large, so the backups hold the messages of this many last days only
  messageDays?: number;
  // Why the last backup failed; `BackupService` clears it with the next success
  lastError?: string;
};

/** The credentials of the backup service for the coming days and the public keys it knows, see `archiveApi.ts` */
export type ArchiveCredentialsRecord = {
  // The backup id of the key they were issued for: a new recovery key voids them
  backupId: Uint8Array;
  // `redemptionTime` is in seconds
  credentials: { type: 'messages' | 'media'; redemptionTime: number; credential: Uint8Array }[];
  publicKeysSet: Partial<Record<'messages' | 'media', boolean>>;
};

/**
 * Everything a registration generates, stored before its request goes out: when the answer is lost, the account may
 * exist on the server, and only these keys can use it
 */
export type PendingRegistration = {
  number: string;
  password: string;
  isPhoneNumberUnlisted: boolean;
  registrationId: number;
  pniRegistrationId: number;
  profileKey: Uint8Array;
  // An account that a PIN restored from SVR2 has a master key and no account entropy pool
  accountEntropyPool?: string;
  masterKey?: Uint8Array;
  mediaRootBackupKey: Uint8Array;
  aciIdentityKeyPair: KeyPairBytes;
  pniIdentityKeyPair: KeyPairBytes;
  aciLastResortPreKeys: LastResortPreKeys;
  pniLastResortPreKeys: LastResortPreKeys;
};

/** Where the primary device uploaded the message history archive */
export type TransferArchive = {
  cdn: number;
  key: string;
};

export type HistoryTransferState = {
  archive?: TransferArchive;
  // Chat items an interrupted import stored; the next import skips them
  importedItemCount?: number;
};

// Sealed sender access of a recipient; `undefined` until a profile fetch or a send shows it
export type SealedSenderAccess = 'enabled' | 'disabled' | 'unrestricted';

/** What the engine knows about another Signal user */
export type RecipientRecord = {
  aci: string;
  pni?: string;
  number?: string;
  profileKey?: Uint8Array;
  sealedSender?: SealedSenderAccess;
  // Expiring profile key credential for adding the recipient to groups, valid for `profileKey` only
  profileKeyCredential?: { credential: Uint8Array; profileKey: Uint8Array; expiresAt: number };
  // When a send found the account gone, by the device clock (Signal Desktop `discoveredUnregisteredAt`)
  discoveredUnregisteredAt?: number;
};

export type SenderCertificateRecord = {
  serialized: Uint8Array;
  // Milliseconds since the epoch
  expiresAt: number;
};

type Items = {
  account: AccountRecord;
  senderCertificate: SenderCertificateRecord;
  aciIdentityKeyPair: KeyPairBytes;
  pniIdentityKeyPair: KeyPairBytes;
  // Next ids for generated keys, per local service id
  nextKeyIds: Record<string, { preKey: number; signedPreKey: number; kyberPreKey: number }>;
  // Blocked phone numbers without a known ACI, kept so the blocked list we sync does not unblock them
  blockedE164s: string[];
  // The numbers of users invited to groups by PNI, by PNI service id; the group state lists only the PNI
  invitedNumbers: Record<string, string>;
  // The devices a demo account lists (`signalDev.seedDemo()`)
  demoDevices: { id: number; name?: string; lastSeen: number }[];
  // Notification defaults by chat type; Signal keeps none on the account, so they stay on this device
  notificationDefaults: Partial<Record<'users' | 'groups' | 'channels', NotificationDefaults>>;
  // Serialized `ManifestRecord` of the last storage service manifest merged here; it lists only ids with a record
  storageManifest: Uint8Array<ArrayBuffer>;
  storageChanges: StorageChanges;
  // A registration whose request went out; `resumePendingRegistration` finds out what became of it
  pendingRegistration: PendingRegistration;
  // The account that unlinked this browser, which keeps its conversations and messages for a new link of that account
  unlinkedAci: string;
  // Merges of stored storage records that this device has done after learning to read more of them
  // (`MessageProcessor`)
  storageMergedRecordTypes: string[];
  // Installed and removed sticker packs by hex pack id; `MessageProcessor` changes them
  stickerPacks: Record<string, StickerPackRecord>;
  // Recently sent stickers, newest first, as `<pack id>:<sticker id>`
  recentStickers: string[];
  cdsiToken: CdsiToken;
  storyDistributionLists: StoryDistributionList[];
  // Notification profiles of the storage service, deleted ones included, and the manual override of the account
  // record (`NotificationProfileManager`)
  notificationProfiles: NotificationProfile[];
  notificationProfileOverride: NotificationProfileOverride;
  // The account record says that profiles are not synced between the devices; this device then has no profiles
  isNotificationProfileSyncDisabled: boolean;
  // Receipts for messages and stories of ours that are not stored yet, oldest first (`MessageProcessor`)
  earlyReceipts: EarlyReceiptRecord[];
  // Key transparency (`keytrans/KeyTransparency.ts`): the serialized `StoredTreeHead` of the last distinguished tree
  // head, the result of our last self check, and when it ran by the device clock
  keyTransparencyDistinguished: Uint8Array<ArrayBuffer>;
  keyTransparencySelfHealth: KeyTransparencySelfHealth;
  keyTransparencyLastSelfCheck: number;
  archiveCredentials: ArchiveCredentialsRecord;
};

/** `intermittent` is a first failed verification, which the self check repeats a day later before it reports `fail` */
export type KeyTransparencySelfHealth = 'ok' | 'intermittent' | 'fail';

/** A delivery, read or viewed receipt that arrived before the message or story it names */
export type EarlyReceiptRecord = {
  senderAci: string;
  // The Signal timestamp of the message or story
  sentAt: number;
  status: 'delivered' | 'read' | 'viewed';
  // The device clock, which sets how long the receipt is kept
  receivedAt: number;
};

/** The contact discovery token for the numbers of earlier contact refreshes, which later refreshes send again */
export type CdsiToken = {
  token: Uint8Array;
  e164s: string[];
};

/** A story distribution list of the storage service; My Story has `MY_STORY_ID` (`stories/storyLists.ts`) */
export type StoryDistributionList = {
  // UUID string, also the distribution id of the list's sender key
  id: string;
  name: string;
  // With `isBlockList`, the people My Story leaves out; otherwise the people the list goes to
  memberAcis: string[];
  // Binary service ids of members that are no ACIs, such as PNIs, which the storage service record keeps as they are
  otherMemberIds?: Uint8Array[];
  areRepliesAllowed: boolean;
  isBlockList: boolean;
  // Deleted lists stay until the storage service drops them
  deletedAt?: number;
};

export type NotificationDefaults = {
  isMuted?: boolean;
  shouldShowPreviews?: boolean;
};

export type IdentityRecord = {
  publicKey: Uint8Array;
  // Whether we compared the safety number (`Verified.State`); a changed key of a verified contact is `UNVERIFIED`
  verified?: Verified_State;
};

export type KyberPreKeyEntry = {
  record: Uint8Array;
  isLastResort?: boolean;
};

export type UnprocessedEnvelope = {
  id: string;
  envelope: Uint8Array;
  receivedAt: number;
  // Saved once decrypted: the ratchet has moved on, so the envelope cannot be decrypted again
  decrypted?: {
    senderServiceId: string;
    senderDeviceId: number;
    destinationServiceId: string;
    // Serialized `Content`
    content: Uint8Array;
    isSealedSender: boolean;
    groupId?: Uint8Array;
  };
};

/** A device that our sender key distribution message reached */
export type SenderKeyDevice = {
  serviceId: string;
  deviceId: number;
  registrationId: number;
};

/** Our sender key for a group (Signal Desktop `SenderKeyInfoType`) */
export type SenderKeyInfoRecord = {
  // UUID string
  distributionId: string;
  createdAt: number;
  memberDevices: SenderKeyDevice[];
};

/**
 * Group send endorsements received with the group state. Each endorsement authorizes sealed sender sends
 * to a member; combined, they authorize one multi-recipient send.
 */
export type GroupSendEndorsementsRecord = {
  // Seconds since the epoch
  expiration: number;
  // Endorsement of each member, us included, by ACI
  members: Record<string, Uint8Array>;
  // Combined endorsement of every member but us
  combined: Uint8Array;
};

/** Content we sent, kept so a recipient that failed to decrypt it can ask for it again */
export type SentProtoRecord = {
  timestamp: number;
  // Serialized `Content`
  content: Uint8Array;
  contentHint: number;
  recipients: string[];
  groupId?: Uint8Array;
  isUrgent: boolean;
  savedAt: number;
};

const DB_NAME = 'ts-signal';

/**
 * Persistent protocol state of the linked device: account credentials, identity keys,
 * sessions, prekeys, sender keys and envelopes received but not processed yet.
 * Keys are namespaced inside one IndexedDB object store.
 */
export default class SignalStore {
  private db = new IdbStore(DB_NAME);

  private exclusive = Promise.resolve();

  // Called when the identity key of another user replaces the stored one, see `saveIdentity`
  onIdentityChange?: (serviceId: string) => void;

  /**
   * Runs protocol operations one at a time. Session, sender key and prekey records are read and written
   * back across awaits, so a concurrent encryption and decryption would overwrite each other's ratchet state.
   */
  runExclusive<T>(callback: () => Promise<T>): Promise<T> {
    const result = this.exclusive.then(callback);
    this.exclusive = result.then(() => undefined, () => undefined);
    return result;
  }

  getItem<K extends keyof Items>(key: K) {
    return this.db.get<Items[K]>(`item:${key}`);
  }

  setItem<K extends keyof Items>(key: K, value: Items[K]) {
    return this.db.set(`item:${key}`, value);
  }

  removeItem(key: keyof Items) {
    return this.db.del(`item:${key}`);
  }

  getRecipient(aci: string) {
    return this.db.get<RecipientRecord>(`recipient:${aci}`);
  }

  /** Merges `update` into the record of `aci`, creating it when absent */
  async updateRecipient(aci: string, update: Partial<Omit<RecipientRecord, 'aci'>>) {
    const recipient = await this.getRecipient(aci);
    const updated = { ...recipient, ...update, aci };
    await this.db.set(`recipient:${aci}`, updated);
    return updated;
  }

  getSession(address: string) {
    return this.db.get<Uint8Array>(`session:${address}`);
  }

  setSession(address: string, record: Uint8Array) {
    return this.db.set(`session:${address}`, record);
  }

  removeSession(address: string) {
    return this.db.del(`session:${address}`);
  }

  /** Device ids of `serviceId` that have a session */
  async getSessionDeviceIds(serviceId: string) {
    const prefix = `session:${serviceId}.`;
    const keys = await this.db.keys();
    return keys
      .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
      .map((key) => Number(key.slice(prefix.length)));
  }

  getIdentity(serviceId: string) {
    return this.db.get<IdentityRecord>(`identity:${serviceId}`);
  }

  setIdentity(serviceId: string, record: IdentityRecord) {
    return this.db.set(`identity:${serviceId}`, record);
  }

  getPreKey(ourServiceId: string, id: number) {
    return this.db.get<Uint8Array>(`preKey:${ourServiceId}:${id}`);
  }

  setPreKeys(ourServiceId: string, records: [number, Uint8Array][]) {
    return this.db.setMany(records.map(([id, record]) => [`preKey:${ourServiceId}:${id}`, record]));
  }

  removePreKey(ourServiceId: string, id: number) {
    return this.db.del(`preKey:${ourServiceId}:${id}`);
  }

  getSignedPreKey(ourServiceId: string, id: number) {
    return this.db.get<Uint8Array>(`signedPreKey:${ourServiceId}:${id}`);
  }

  setSignedPreKey(ourServiceId: string, id: number, record: Uint8Array) {
    return this.db.set(`signedPreKey:${ourServiceId}:${id}`, record);
  }

  getKyberPreKey(ourServiceId: string, id: number) {
    return this.db.get<KyberPreKeyEntry>(`kyberPreKey:${ourServiceId}:${id}`);
  }

  setKyberPreKeys(ourServiceId: string, entries: [number, KyberPreKeyEntry][]) {
    return this.db.setMany(entries.map(([id, entry]) => [`kyberPreKey:${ourServiceId}:${id}`, entry]));
  }

  removeKyberPreKey(ourServiceId: string, id: number) {
    return this.db.del(`kyberPreKey:${ourServiceId}:${id}`);
  }

  /** The serialized `StoredAccountData` that key transparency keeps for `aci` */
  getKeyTransparencyAccountData(aci: string) {
    return this.db.get<Uint8Array<ArrayBuffer>>(`keyTransparency:${aci}`);
  }

  setKeyTransparencyAccountData(aci: string, data: Uint8Array<ArrayBuffer>) {
    return this.db.set(`keyTransparency:${aci}`, data);
  }

  getSenderKey(key: string) {
    return this.db.get<Uint8Array>(`senderKey:${key}`);
  }

  setSenderKey(key: string, record: Uint8Array) {
    return this.db.set(`senderKey:${key}`, record);
  }

  removeSenderKey(key: string) {
    return this.db.del(`senderKey:${key}`);
  }

  /** `groupId` is the base64 group identifier */
  getSenderKeyInfo(groupId: string) {
    return this.db.get<SenderKeyInfoRecord>(`senderKeyInfo:${groupId}`);
  }

  setSenderKeyInfo(groupId: string, record: SenderKeyInfoRecord) {
    return this.db.set(`senderKeyInfo:${groupId}`, record);
  }

  getGroupSendEndorsements(groupId: string) {
    return this.db.get<GroupSendEndorsementsRecord>(`groupSendEndorsements:${groupId}`);
  }

  setGroupSendEndorsements(groupId: string, record: GroupSendEndorsementsRecord) {
    return this.db.set(`groupSendEndorsements:${groupId}`, record);
  }

  removeGroupSendEndorsements(groupId: string) {
    return this.db.del(`groupSendEndorsements:${groupId}`);
  }

  /** Decrypted manifests of sticker packs by hex pack id; they never change, so they are kept for any pack seen */
  getStickerPackManifest(id: string) {
    return this.db.get<StickerPackManifest>(`stickerPackManifest:${id}`);
  }

  setStickerPackManifest(id: string, manifest: StickerPackManifest) {
    return this.db.set(`stickerPackManifest:${id}`, manifest);
  }

  /** Serialized `StorageRecord`s of the storage manifest by base64 storage id, kept to write them back */
  getStorageRecords(ids: string[]) {
    return this.db.getMany<Uint8Array<ArrayBuffer> | undefined>(ids.map((id) => `storageRecord:${id}`));
  }

  setStorageRecords(records: Map<string, Uint8Array>) {
    return this.db.setMany([...records].map(([id, record]) => [`storageRecord:${id}`, record]));
  }

  removeStorageRecords(ids: string[]) {
    return this.db.delMany(ids.map((id) => `storageRecord:${id}`));
  }

  addSentProto(record: SentProtoRecord) {
    return this.db.set(`sentProto:${record.timestamp}`, record);
  }

  getSentProto(timestamp: number) {
    return this.db.get<SentProtoRecord>(`sentProto:${timestamp}`);
  }

  async removeSentProtosBefore(time: number) {
    const entries = await this.db.entries();
    const keys = entries
      .filter(([key, value]) => (
        typeof key === 'string' && key.startsWith('sentProto:') && (value as SentProtoRecord).savedAt < time
      ))
      .map(([key]) => key as string);
    await this.db.delMany(keys);
  }

  addUnprocessed(envelope: UnprocessedEnvelope) {
    return this.db.set(`unprocessed:${envelope.id}`, envelope);
  }

  removeUnprocessed(id: string) {
    return this.db.del(`unprocessed:${id}`);
  }

  async getAllUnprocessed() {
    const entries = await this.db.entries();
    return entries
      .filter(([key]) => typeof key === 'string' && key.startsWith('unprocessed:'))
      .map(([, value]) => value as UnprocessedEnvelope)
      .sort((a, b) => a.receivedAt - b.receivedAt);
  }

  clear() {
    return this.db.clear();
  }
}
