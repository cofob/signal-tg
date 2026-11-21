import { IdbStore } from '../../../util/browser/idb';
import {
  decryptValue, type EncryptedValue, encryptValue, isEncryptedValue, isEncryptingWrites, StorageLockedError,
} from './atRest';

/** Which way `SecureIdbStore.convertAll` rewrites the records */
export type ConversionDirection = 'encrypt' | 'decrypt';

export type RecordCounts = {
  encrypted: number;
  plain: number;
};

const BATCH_SIZE = 100;

/**
 * An `IdbStore` whose values are encrypted while the engine has a key (`atRest.ts`). The keys of the records stay
 * readable. A record without an envelope is read as it is, so the store works before the migration and after an
 * interrupted one.
 */
export default class SecureIdbStore {
  private store: IdbStore;

  constructor(name: string) {
    this.store = new IdbStore(name);
  }

  async get<T = unknown>(key: string) {
    return this.read(key, await this.store.get<unknown>(key)) as Promise<T | undefined>;
  }

  async getMany<T = unknown>(keys: string[]) {
    const values = await this.store.getMany<unknown>(keys);
    return Promise.all(values.map((value, index) => this.read(keys[index], value))) as Promise<T[]>;
  }

  async set(key: string, value: unknown) {
    await this.store.set(key, await this.write(key, value));
  }

  async setMany(entries: [string, unknown][]) {
    const written = await Promise.all(entries.map(async ([key, value]) => (
      [key, await this.write(key, value)] as [string, unknown]
    )));
    await this.store.setMany(written);
  }

  /** The records whose keys start with `prefix`, or all of them */
  async entries(prefix = '') {
    const keys = (await this.store.keys()).filter((key): key is string => typeof key === 'string'
      && key.startsWith(prefix));
    const values = await this.getMany(keys);
    return keys.map((key, index) => [key, values[index]] as [string, unknown]);
  }

  keys() {
    return this.store.keys();
  }

  del(key: string) {
    return this.store.del(key);
  }

  delMany(keys: string[]) {
    return this.store.delMany(keys);
  }

  clear() {
    return this.store.clear();
  }

  /** The value as it is stored, without the envelope's decryption; for keys that must be readable without the key */
  getPlain<T = unknown>(key: string) {
    return this.store.get<T>(key);
  }

  setPlain(key: string, value: unknown) {
    return this.store.set(key, value);
  }

  /**
   * Rewrites every record whose key is not in `skippedKeys` in the direction. A record that changed since it was read
   * stays as the change left it: it is written in the current mode already. Returns the number of records that could
   * not be decrypted, which stay as they are.
   */
  async convertAll(direction: ConversionDirection, skippedKeys: string[] = []) {
    const keys = await this.getKeys(skippedKeys);
    let failedCount = 0;
    for (let index = 0; index < keys.length; index += BATCH_SIZE) {
      for (const key of keys.slice(index, index + BATCH_SIZE)) {
        if (!await this.convert(key, direction)) failedCount++;
      }
    }
    return failedCount;
  }

  /** How many records are encrypted and how many are not, without the records in `skippedKeys` */
  async countRecords(skippedKeys: string[] = []): Promise<RecordCounts> {
    const keys = await this.getKeys(skippedKeys);
    const counts = { encrypted: 0, plain: 0 };
    for (let index = 0; index < keys.length; index += BATCH_SIZE) {
      const values = await this.store.getMany<unknown>(keys.slice(index, index + BATCH_SIZE));
      for (const value of values) {
        if (value === undefined) continue;
        counts[isEncryptedValue(value) ? 'encrypted' : 'plain']++;
      }
    }
    return counts;
  }

  /** Deletes the encrypted records that the key does not open, and returns their number */
  async deleteUnreadable(skippedKeys: string[] = []) {
    const keys = await this.getKeys(skippedKeys);
    const unreadable: string[] = [];
    for (const key of keys) {
      const stored = await this.store.get<unknown>(key);
      if (!isEncryptedValue(stored)) continue;

      try {
        await decryptValue(this.getContext(key), stored);
      } catch (err) {
        if (err instanceof StorageLockedError) throw err;
        unreadable.push(key);
      }
    }
    await this.store.delMany(unreadable);
    return unreadable.length;
  }

  private async getKeys(skippedKeys: string[]) {
    return (await this.store.keys()).filter((key): key is string => typeof key === 'string'
      && !skippedKeys.includes(key));
  }

  /** Returns `false` for a record that cannot be decrypted */
  private async convert(key: string, direction: ConversionDirection) {
    const stored = await this.store.get<unknown>(key);
    if (stored === undefined || isEncryptedValue(stored) === (direction === 'encrypt')) return true;

    let converted: unknown;
    try {
      converted = direction === 'encrypt'
        ? await encryptValue(this.getContext(key), stored)
        : await decryptValue(this.getContext(key), stored as EncryptedValue);
    } catch (err) {
      if (err instanceof StorageLockedError) throw err;
      return false;
    }

    // One transaction reads the record again and writes only a record that is still there as it was read, so a
    // record that was deleted or written meanwhile is not brought back or overwritten
    await this.store.store('readwrite', (objectStore) => new Promise<void>((resolve, reject) => {
      const request = objectStore.get(key);
      request.onsuccess = () => {
        const current: unknown = request.result;
        if (current === undefined) return;
        const isUnchanged = direction === 'encrypt'
          ? !isEncryptedValue(current)
          : isSameEnvelope(current, stored);
        if (isUnchanged) objectStore.put(converted, key);
      };
      objectStore.transaction.oncomplete = () => resolve();
      objectStore.transaction.onerror = () => reject(objectStore.transaction.error);
      objectStore.transaction.onabort = () => reject(objectStore.transaction.error);
    }));
    return true;
  }

  private read(key: string, stored: unknown) {
    return isEncryptedValue(stored) ? decryptValue(this.getContext(key), stored) : Promise.resolve(stored);
  }

  private write(key: string, value: unknown) {
    return isEncryptingWrites() ? encryptValue(this.getContext(key), value) : Promise.resolve(value);
  }

  private getContext(key: string) {
    return `store|${key}`;
  }
}

function isSameEnvelope(a: unknown, b: unknown) {
  if (!isEncryptedValue(a) || !isEncryptedValue(b)) return false;
  return a.iv.length === b.iv.length && a.iv.every((byte, index) => byte === b.iv[index]);
}
