import { clone, create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type { ConversationRecord } from '../db/MessageDb';
import type {
  AccountRecord,
  AccountRecord_PinnedConversation,
  ContactRecord,
  GroupV2Record,
  ManifestRecord,
  StorageRecord,
} from '../proto/generated/StorageService_pb';
import type { AccountRecord as LocalAccount } from '../store/SignalStore';
import type { StorageWrite } from './storageService';

import { bufferFromBase64, bufferToBase64 } from '../../../util/encoding/buffer';
import { getRandomBytes } from '../crypto';
import { uuidToBytes, uuidToString } from '../serviceId';

import {
  AccountRecord_PhoneNumberSharingMode,
  AccountRecord_PinnedConversationSchema,
  AccountRecord_UsernameLinkSchema,
  ManifestRecord_Identifier_Type as ItemType,
  ManifestRecord_IdentifierSchema,
  ManifestRecordSchema,
  StorageRecordSchema,
} from '../proto/generated/StorageService_pb';

type ConversationRecordField = 'archived' | 'markedUnread' | 'mutedUntilTimestamp' | 'blocked' | 'whitelisted';
// The profile key is not a conversation field: contact records get the one of the recipient
type ConversationStorageField = ConversationRecordField | 'profileKey';
export type AccountStorageField = 'pinnedConversations' | 'noteToSelfArchived' | 'noteToSelfMarkedUnread' | 'username'
  | 'usernameLink' | 'phoneNumberSharingMode' | 'unlistedPhoneNumber' | 'givenName' | 'familyName' | 'avatarUrlPath';
type StorageField = ConversationStorageField | AccountStorageField;

/** Account record fields that this device keeps on its account (`SignalStore`), not on a conversation */
export type LocalAccountFields = Pick<LocalAccount, 'usernameLink' | 'isPhoneNumberShared' | 'isPhoneNumberUnlisted'>;

/** Record fields changed on this device and not written yet, by conversation id or `ACCOUNT_KEY` */
export type StorageChanges = Record<string, StorageField[]>;

/** What a write starts from: the stored manifest, its records and the local state */
type StorageWriteSource = {
  manifest: ManifestRecord;
  // Serialized `StorageRecord`s by base64 storage id
  records: Map<string, Uint8Array>;
  changes: StorageChanges;
  conversations: ConversationRecord[];
  // Profile keys of the private conversations with changes
  profileKeys: Map<string, Uint8Array>;
  selfAci: string;
  deviceId: number;
  localAccount: LocalAccountFields;
};

// Conversation ids are ACIs and base64 group ids, so they never equal this key
export const ACCOUNT_KEY = 'account';

const ACI_BINARY_LENGTH = 16;
// Signal Desktop `generateStorageID` in `ts/services/storage.preload.ts`
const STORAGE_ID_LENGTH = 16;
// Signal Desktop `MuteExpiration` (`packages/types/src/service/MuteExpiration.std.ts`): "muted forever" is
// `Number.MAX_SAFE_INTEGER` locally and the largest signed 64-bit number in records
const MAX_SAFE_DATE = 8_640_000_000_000_000;
const MUTED_FOREVER_PROTO = 2n ** 63n - 1n;
const CONVERSATION_FIELDS: Record<ConversationRecordField, keyof ConversationRecord> = {
  archived: 'isArchived',
  markedUnread: 'isMarkedUnread',
  mutedUntilTimestamp: 'mutedUntil',
  blocked: 'isBlocked',
  whitelisted: 'isAccepted',
};
const CONVERSATION_FIELD_NAMES = Object.keys(CONVERSATION_FIELDS) as ConversationRecordField[];

/**
 * The record fields that a local change of a conversation touches. Note to Self keeps its state and every pin
 * keeps its position in the account record.
 */
export function getStorageChanges(previous: ConversationRecord, next: ConversationRecord, selfAci: string) {
  const changes: StorageChanges = {};
  const add = (key: string, field: StorageField) => {
    changes[key] = [...changes[key] ?? [], field];
  };

  if (previous.pinIndex !== next.pinIndex) add(ACCOUNT_KEY, 'pinnedConversations');
  if (next.id === selfAci) {
    if (Boolean(previous.isArchived) !== Boolean(next.isArchived)) add(ACCOUNT_KEY, 'noteToSelfArchived');
    if (Boolean(previous.isMarkedUnread) !== Boolean(next.isMarkedUnread)) add(ACCOUNT_KEY, 'noteToSelfMarkedUnread');
    return changes;
  }

  for (const field of CONVERSATION_FIELD_NAMES) {
    const key = CONVERSATION_FIELDS[field];
    if ((previous[key] || undefined) !== (next[key] || undefined)) add(next.id, field);
  }
  return changes;
}

export function mergeStorageChanges(changes: StorageChanges, added: StorageChanges) {
  const merged = { ...changes };
  for (const [key, fields] of Object.entries(added)) {
    merged[key] = [...new Set([...merged[key] ?? [], ...fields])];
  }
  return merged;
}

/** Leaves out the fields of a remote record that changed locally since the last write, so local changes win */
export function omitChangedFields(patch: Partial<ConversationRecord>, fields?: StorageField[]) {
  const result = { ...patch };
  for (const field of fields ?? []) {
    if (field in CONVERSATION_FIELDS) delete result[CONVERSATION_FIELDS[field as ConversationRecordField]];
  }
  return result;
}

/** The ACI of a record field pair such as `aci` and `aciBinary`; PNIs in binary fields have a prefix byte */
export function getAci(serviceId: string, serviceIdBinary: Uint8Array) {
  return serviceId || (serviceIdBinary.length === ACI_BINARY_LENGTH ? uuidToString(serviceIdBinary) : undefined);
}

export function getMutedUntil(timestamp: bigint) {
  if (timestamp <= 0n) return undefined;
  return timestamp >= BigInt(MAX_SAFE_DATE) ? Number.MAX_SAFE_INTEGER : Number(timestamp);
}

/**
 * Builds the next manifest from the stored one (Signal Desktop `generateManifest` in
 * `ts/services/storage.preload.ts`): each record with local changes is written again under a new random storage id
 * and its old id is deleted. Fields without local changes keep their remote values, unknown fields stay, and
 * records of other types keep their ids. A conversation without a record gets one; the account record is left to
 * the primary device until it exists. Returns `undefined` when nothing changed, else the write and the keys of
 * `changes` it carries: changes of records that cannot be written yet stay marked.
 */
export function buildStorageWrite({
  manifest, records, changes, conversations, profileKeys, selfAci, deviceId, localAccount,
}: StorageWriteSource): { write: StorageWrite; writtenKeys: string[] } | undefined {
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const storedRecords = indexRecords(records);
  const inserts = new Map<string, Uint8Array<ArrayBuffer>>();
  const insertTypes = new Map<string, ItemType>();
  const deleteIds: string[] = [];
  const writtenKeys: string[] = [];

  for (const [key, fields] of Object.entries(changes)) {
    const conversation = conversationsById.get(key);
    const recordKey = key === ACCOUNT_KEY ? key : conversation && getRecordKey(conversation);
    if (!recordKey) continue;
    const stored = storedRecords.get(recordKey);

    let record: StorageRecord;
    if (stored?.record.record.case === 'account') {
      record = stored.record;
      setAccountFields(stored.record.record.value, fields, conversations, selfAci, localAccount);
    } else if (conversation) {
      record = stored?.record ?? createConversationRecord(conversation, profileKeys.get(conversation.id));
      const { value } = record.record as { value: ContactRecord | GroupV2Record };
      setConversationFields(
        value, conversation, stored ? fields : CONVERSATION_FIELD_NAMES, profileKeys.get(conversation.id),
      );
    } else {
      continue;
    }

    const id = bufferToBase64(getRandomBytes(STORAGE_ID_LENGTH));
    inserts.set(id, toBinary(StorageRecordSchema, record));
    insertTypes.set(id, getItemType(record));
    writtenKeys.push(key);
    if (stored) deleteIds.push(stored.id);
  }
  if (!inserts.size) return undefined;

  const next = clone(ManifestRecordSchema, manifest);
  const deleted = new Set(deleteIds);
  next.version = manifest.version + 1n;
  next.sourceDevice = deviceId;
  next.identifiers = next.identifiers.filter(({ raw }) => !deleted.has(bufferToBase64(raw)));
  for (const [id, type] of insertTypes) {
    next.identifiers.push(create(ManifestRecord_IdentifierSchema, { raw: bufferFromBase64(id), type }));
  }
  return { write: { manifest: next, inserts, deleteIds }, writtenKeys };
}

/**
 * The number of pinned conversations: the local ones and the pins of the account record that this device has no
 * conversation for, such as the release notes chat. `records` are the stored records of the manifest.
 */
export function countPinnedConversations(records: Map<string, Uint8Array>, conversations: ConversationRecord[]) {
  const { record } = indexRecords(records).get(ACCOUNT_KEY)?.record ?? {};
  return buildPinnedConversations(record?.case === 'account' ? record.value.pinnedConversations : [], conversations)
    .length;
}

/** Stored records by what they belong to: a contact's ACI, `group:` and a group's master key, or the account */
function indexRecords(records: Map<string, Uint8Array>) {
  const index = new Map<string, { id: string; record: StorageRecord }>();
  for (const [id, serialized] of records) {
    const record = fromBinary(StorageRecordSchema, serialized);
    const key = getStoredRecordKey(record);
    if (key) index.set(key, { id, record });
  }
  return index;
}

function getStoredRecordKey({ record }: StorageRecord) {
  switch (record.case) {
    case 'contact':
      return getAci(record.value.aci, record.value.aciBinary);
    case 'groupV2':
      return record.value.masterKey.length ? getGroupKey(record.value.masterKey) : undefined;
    case 'account':
      return ACCOUNT_KEY;
    default:
      return undefined;
  }
}

function getRecordKey(conversation: ConversationRecord) {
  if (conversation.type === 'private') return conversation.id;
  return conversation.masterKey && getGroupKey(conversation.masterKey);
}

function getGroupKey(masterKey: Uint8Array) {
  return `group:${bufferToBase64(masterKey)}`;
}

function getItemType({ record }: StorageRecord) {
  switch (record.case) {
    case 'contact':
      return ItemType.CONTACT;
    case 'groupV2':
      return ItemType.GROUPV2;
    default:
      return ItemType.ACCOUNT;
  }
}

function createConversationRecord(conversation: ConversationRecord, profileKey?: Uint8Array) {
  if (conversation.type === 'group') {
    return create(StorageRecordSchema, { record: { case: 'groupV2', value: { masterKey: conversation.masterKey } } });
  }
  // Signal Android `StorageSyncModels.localToRemoteContact` writes service ids in binary only
  return create(StorageRecordSchema, {
    record: {
      case: 'contact',
      value: {
        aciBinary: uuidToBytes(conversation.id),
        e164: conversation.e164,
        profileKey,
        givenName: conversation.profileName,
        familyName: conversation.profileFamilyName,
      },
    },
  });
}

function setConversationFields(
  record: ContactRecord | GroupV2Record,
  conversation: ConversationRecord,
  fields: StorageField[],
  profileKey?: Uint8Array,
) {
  for (const field of fields) {
    switch (field) {
      case 'archived':
        record.archived = Boolean(conversation.isArchived);
        break;
      case 'markedUnread':
        record.markedUnread = Boolean(conversation.isMarkedUnread);
        break;
      case 'mutedUntilTimestamp':
        record.mutedUntilTimestamp = getMutedUntilTimestamp(conversation.mutedUntil);
        break;
      case 'blocked': {
        const isBlocked = Boolean(conversation.isBlocked);
        if (record.blocked !== isBlocked) record.blockedAtTimestamp = isBlocked ? BigInt(Date.now()) : 0n;
        record.blocked = isBlocked;
        break;
      }
      case 'whitelisted':
        record.whitelisted = Boolean(conversation.isAccepted);
        break;
      case 'profileKey':
        if (profileKey && 'profileKey' in record) record.profileKey = profileKey;
        break;
      default:
        break;
    }
  }
}

function setAccountFields(
  record: AccountRecord,
  fields: StorageField[],
  conversations: ConversationRecord[],
  selfAci: string,
  { usernameLink, isPhoneNumberShared, isPhoneNumberUnlisted }: LocalAccountFields,
) {
  const self = conversations.find(({ id }) => id === selfAci);
  for (const field of fields) {
    switch (field) {
      case 'pinnedConversations':
        record.pinnedConversations = buildPinnedConversations(record.pinnedConversations, conversations);
        break;
      case 'noteToSelfArchived':
        record.noteToSelfArchived = Boolean(self?.isArchived);
        break;
      case 'noteToSelfMarkedUnread':
        record.noteToSelfMarkedUnread = Boolean(self?.isMarkedUnread);
        break;
      case 'username':
        record.username = self?.username ?? '';
        break;
      // Signal Desktop `toAccountRecord` in `ts/services/storageRecordOps.preload.ts`
      case 'givenName':
        record.givenName = self?.profileName ?? '';
        break;
      case 'familyName':
        record.familyName = self?.profileFamilyName ?? '';
        break;
      case 'avatarUrlPath':
        record.avatarUrlPath = self?.avatarPath ?? '';
        break;
      case 'usernameLink':
        if (!usernameLink) {
          record.usernameLink = undefined;
          break;
        }
        // The link color is a setting of the primary device, so it stays
        record.usernameLink ??= create(AccountRecord_UsernameLinkSchema);
        record.usernameLink.entropy = usernameLink.entropy;
        record.usernameLink.serverId = uuidToBytes(usernameLink.serverId);
        break;
      case 'phoneNumberSharingMode':
        record.phoneNumberSharingMode = isPhoneNumberShared
          ? AccountRecord_PhoneNumberSharingMode.EVERYBODY
          : AccountRecord_PhoneNumberSharingMode.NOBODY;
        break;
      case 'unlistedPhoneNumber':
        record.unlistedPhoneNumber = Boolean(isPhoneNumberUnlisted);
        break;
      default:
        break;
    }
  }
}

/**
 * Local pins in their order, then the remote pins of conversations this device does not have, such as the release
 * notes chat, so that writing the account record keeps them
 */
function buildPinnedConversations(remote: AccountRecord_PinnedConversation[], conversations: ConversationRecord[]) {
  const localKeys = new Set(conversations.map(getRecordKey));
  const pinned = conversations
    .filter((conversation) => conversation.pinIndex !== undefined && getRecordKey(conversation))
    .sort((a, b) => a.pinIndex! - b.pinIndex!)
    .map((conversation) => create(AccountRecord_PinnedConversationSchema, {
      identifier: conversation.type === 'group'
        ? { case: 'groupMasterKey', value: conversation.masterKey! }
        : { case: 'contact', value: { serviceIdBinary: uuidToBytes(conversation.id), e164: conversation.e164 } },
    }));
  const kept = remote.filter((pin) => {
    const key = getPinKey(pin);
    return !key || !localKeys.has(key);
  });
  return [...pinned, ...kept];
}

function getPinKey({ identifier }: AccountRecord_PinnedConversation) {
  if (identifier.case === 'contact') return getAci(identifier.value.serviceId, identifier.value.serviceIdBinary);
  return identifier.case === 'groupMasterKey' ? getGroupKey(identifier.value) : undefined;
}

/** Signal Desktop `MuteExpiration.toProto` */
function getMutedUntilTimestamp(mutedUntil?: number) {
  if (!mutedUntil) return 0n;
  return mutedUntil >= MAX_SAFE_DATE ? MUTED_FOREVER_PROTO : BigInt(mutedUntil);
}
