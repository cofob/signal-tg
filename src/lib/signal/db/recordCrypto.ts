import {
  decryptValue, type EncryptedValue, encryptValue, isEncryptedValue, isEncryptingWrites,
} from '../store/atRest';

export type StoreName = 'conversations' | 'messages' | 'stories' | 'calls';

type PlainFields = Record<string, unknown>;

/**
 * An encrypted record keeps only the fields that an index or a key needs, in the clear, and the rest of the record
 * in `enc`. The fields in the clear are part of the authenticated data, so a record cannot be moved to another place
 * or have them changed. `docs/signal/SECURITY.md` lists what stays in the clear.
 */
export type StoredRecord = PlainFields & { enc?: EncryptedValue };

const ENCRYPTED_FIELD = 'enc';

/** Encrypts a record for storing when the engine encrypts writes, or `force` says so; otherwise returns it as it is */
export async function encodeRecord<T extends object>(store: StoreName, record: T, force?: boolean): Promise<T> {
  if (!(force ?? isEncryptingWrites())) return record;

  const plain = getPlainFields(store, record as PlainFields);
  const rest = { ...record } as PlainFields;
  delete rest.id;
  const enc = await encryptValue(getContext(store, plain), rest);
  return { ...plain, [ENCRYPTED_FIELD]: enc } as unknown as T;
}

/** The record as the engine uses it, decrypted when it is stored encrypted */
export async function decodeRecord<T>(store: StoreName, stored: unknown): Promise<T> {
  if (!isEncryptedRecord(stored)) return stored as T;

  const { enc, ...plain } = stored as StoredRecord;
  const rest = await decryptValue(getContext(store, plain), enc!) as PlainFields;
  return { ...rest, ...plain } as T;
}

export async function decodeRecords<T>(store: StoreName, stored: unknown[]): Promise<T[]> {
  return Promise.all(stored.map((record) => decodeRecord<T>(store, record)));
}

export function isEncryptedRecord(stored: unknown) {
  return Boolean(stored) && typeof stored === 'object' && isEncryptedValue((stored as StoredRecord)[ENCRYPTED_FIELD]);
}

export function isSameEncryption(a: unknown, b: unknown) {
  const first = (a as StoredRecord | undefined)?.[ENCRYPTED_FIELD];
  const second = (b as StoredRecord | undefined)?.[ENCRYPTED_FIELD];
  if (!isEncryptedValue(first) || !isEncryptedValue(second)) return false;
  return first.iv.every((byte, index) => byte === second.iv[index]);
}

function getPlainFields(store: StoreName, record: PlainFields): PlainFields {
  switch (store) {
    case 'conversations':
      return { id: record.id, localId: record.localId };
    case 'messages': {
      const sendRetry = record.sendRetry as { at: number } | undefined;
      return omitUndefined({
        id: record.id,
        conversationId: record.conversationId,
        authorAci: record.authorAci,
        sentAt: record.sentAt,
        expiresAt: record.expiresAt,
        sendRetry: sendRetry && { at: sendRetry.at },
      });
    }
    case 'calls':
      return { peerId: record.peerId, callId: record.callId, timestamp: record.timestamp };
    case 'stories':
      return omitUndefined({
        id: record.id, authorAci: record.authorAci, sentAt: record.sentAt, expiresAt: record.expiresAt,
      });
  }
}

function getContext(store: StoreName, plain: PlainFields) {
  // The key of a new message or story is not known when it is encrypted, so only a conversation's key is bound
  const fields = { ...plain };
  if (store !== 'conversations') delete fields.id;
  return `${store}|${JSON.stringify(fields)}`;
}

function omitUndefined(fields: PlainFields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
