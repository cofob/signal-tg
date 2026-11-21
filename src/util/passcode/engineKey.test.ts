import 'fake-indexeddb/auto';

import { beforeAll, describe, expect, test } from 'vitest';

import { PASSCODE_IDB_STORE } from '../browser/idb';
import {
  changePasscode, clearPasscodeStore, createPasscode, forgetDek, getEngineKey, loadPasscodeMeta,
  unlockDekWithPasscode,
} from './index';

const SNAPSHOT = [{ slot: 1, globalJson: '{}' }];

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

beforeAll(() => {
  // jsdom has no Web Locks
  Object.defineProperty(navigator, 'locks', {
    value: { request: (_name: string, callback: () => Promise<unknown>) => callback() },
    configurable: true,
  });
});

describe('Engine key', () => {
  test('is random, stored only wrapped, and kept across a passcode change', async () => {
    await clearPasscodeStore();
    const { generation } = await createPasscode('first passcode', SNAPSHOT);

    const key = await getEngineKey();
    expect(key.byteLength).toBe(32);
    expect(toHex(await getEngineKey())).toBe(toHex(key));

    const stored = await PASSCODE_IDB_STORE.keys();
    expect(stored).toContain(`engineKeyVault_${generation}`);
    // The vault holds ciphertext of the key, not the key
    const wrapped = await PASSCODE_IDB_STORE.get<ArrayBuffer>(`engineKeyVault_${generation}`);
    expect(wrapped!.byteLength).toBeGreaterThan(key.byteLength);
    expect(toHex(wrapped!)).not.toContain(toHex(key));

    // A new passcode wraps the same key again, and the old generation's entry goes away
    const changed = await changePasscode('second passcode');
    expect(changed.generation).not.toBe(generation);
    expect(toHex(await getEngineKey())).toBe(toHex(key));
    const keysAfterChange = await PASSCODE_IDB_STORE.keys();
    expect(keysAfterChange).not.toContain(`engineKeyVault_${generation}`);
    expect(keysAfterChange).toContain(`engineKeyVault_${changed.generation}`);

    // After a lock and an unlock with the new passcode the key is the same
    forgetDek();
    expect(await unlockDekWithPasscode('second passcode')).toBeDefined();
    await expect(unlockDekWithPasscode('first passcode')).rejects.toThrow();
    await expect(getEngineKey()).rejects.toThrow();
  });

  test('is created for a passcode that has none yet', async () => {
    await clearPasscodeStore();
    const { generation } = await createPasscode('passcode', SNAPSHOT);
    await PASSCODE_IDB_STORE.del(`engineKeyVault_${generation}`);
    expect(await loadPasscodeMeta()).toBeDefined();

    const key = await getEngineKey();
    expect(key.byteLength).toBe(32);
    await changePasscode('another passcode');
    expect(toHex(await getEngineKey())).toBe(toHex(key));
  });

  test('is removed with the passcode store', async () => {
    await clearPasscodeStore();
    await createPasscode('passcode', SNAPSHOT);
    await getEngineKey();
    await clearPasscodeStore();
    expect(await PASSCODE_IDB_STORE.keys()).toEqual([]);
    await expect(getEngineKey()).rejects.toThrow();
  });
});
