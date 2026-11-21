import { IdbStore } from '../../../util/browser/idb';
import {
  decryptValue, type EncryptedValue, encryptValue, isEncryptedValue, isEncryptingWrites,
} from './atRest';

/** Which way `SecureIdbStore.convertAll` rewrites the records */
export type ConversionDirection = 'encrypt' | 'decrypt';

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
   * Rewrites every record whose key is not in `skippedKeys` in the direction, in batches. A record that changed
   * since it was read stays as the change left it: it is written in the current mode already.
   */
  async convertAll(direction: ConversionDirection, skippedKeys: string[] = []) {
    const keys = (await this.store.keys()).filter((key): key is string => typeof key === 'string'
      && !skippedKeys.includes(key));
    for (let index = 0; index < keys.length; index += BATCH_SIZE) {
      for (const key of keys.slice(index, index + BATCH_SIZE)) {
        await this.convert(key, direction);
      }
    }
  }

  private async convert(key: string, direction: ConversionDirection) {
    const stored = await this.store.get<unknown>(key);
    if (stored === undefined || isEncryptedValue(stored) === (direction === 'encrypt')) return;

    const converted = direction === 'encrypt'
      ? await encryptValue(this.getContext(key), stored)
      : await decryptValue(this.getContext(key), stored as EncryptedValue);
    await this.store.update<unknown>(key, (current) => {
      // `update` runs in one transaction: keep a record that was written or deleted since the read
      if (current === undefined || isEncryptedValue(current) !== (direction === 'decrypt')) return current;
      return direction === 'encrypt' || isSameEnvelope(current, stored) ? converted : current;
    });
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
