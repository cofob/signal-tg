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
  deviceName: string;
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
  // The sync requests to the primary device after linking went out
  isInitialSyncDone?: boolean;
  // Seeded by `signalDev.seedDemo()` to check the UI without a phone: the client never connects
  isDemo?: boolean;
  // Set at linking when the primary device offers to transfer message history; removed once the transfer ends
  historyTransfer?: HistoryTransferState;
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
};

export type IdentityRecord = {
  publicKey: Uint8Array;
  isVerified?: boolean;
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
  };
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

  getSenderKey(key: string) {
    return this.db.get<Uint8Array>(`senderKey:${key}`);
  }

  setSenderKey(key: string, record: Uint8Array) {
    return this.db.set(`senderKey:${key}`, record);
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
