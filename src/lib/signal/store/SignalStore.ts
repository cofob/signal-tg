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
};

type Items = {
  account: AccountRecord;
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
};

const DB_NAME = 'ts-signal';

/**
 * Persistent protocol state of the linked device: account credentials, identity keys,
 * sessions, prekeys, sender keys and envelopes received but not processed yet.
 * Keys are namespaced inside one IndexedDB object store.
 */
export default class SignalStore {
  private db = new IdbStore(DB_NAME);

  getItem<K extends keyof Items>(key: K) {
    return this.db.get<Items[K]>(`item:${key}`);
  }

  setItem<K extends keyof Items>(key: K, value: Items[K]) {
    return this.db.set(`item:${key}`, value);
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
