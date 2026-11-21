import {
  beforeEach, describe, expect, test, vi,
} from 'vitest';

const calls: string[] = [];
const getItem = vi.fn();
const unlinkDevice = vi.fn();
const logError = vi.fn();

vi.mock('../engine', () => ({ store: { getItem }, db: {}, logError }));
vi.mock('../client', () => ({
  stopClient: vi.fn(() => {
    calls.push('stopClient');
    return Promise.resolve();
  }),
  reconnectClient: vi.fn(),
}));
vi.mock('../../../lib/signal/account/linkDevice', () => ({ unlinkDevice }));
vi.mock('../../../lib/signal/store/atRestMigration', () => ({
  disableEncryptionAtRest: vi.fn(),
  enableEncryptionAtRest: vi.fn(),
  forgetStorageKey: vi.fn(() => {
    calls.push('forgetStorageKey');
    return Promise.resolve();
  }),
}));

const { destroy } = await import('./client');

const LINKED = { aci: 'aci', deviceId: 2, password: 'secret' };

beforeEach(() => {
  calls.length = 0;
  getItem.mockReset();
  unlinkDevice.mockReset();
  logError.mockReset();
});

describe('Logout', () => {
  test('removes a linked device while the data is wiped', async () => {
    getItem.mockResolvedValue(LINKED);
    unlinkDevice.mockImplementation(() => {
      calls.push('unlinkDevice');
      return Promise.resolve();
    });

    await destroy();

    expect(unlinkDevice).toHaveBeenCalledWith(LINKED);
    // The wipe does not wait for the request
    expect(calls.indexOf('stopClient')).toBeLessThan(calls.indexOf('forgetStorageKey'));
    expect(calls).toContain('unlinkDevice');
  });

  test('does not wait for a slow request before wiping, and finishes when it fails', async () => {
    getItem.mockResolvedValue(LINKED);
    let finish: () => void = () => undefined;
    unlinkDevice.mockImplementation(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));

    const logout = destroy();
    await vi.waitFor(() => expect(calls).toContain('forgetStorageKey'));
    finish();
    await logout;

    unlinkDevice.mockRejectedValue(new Error('offline'));
    await destroy();
    expect(logError).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['the primary device', { ...LINKED, deviceId: 1 }],
    ['the demo account', { ...LINKED, isDemo: true }],
    ['no account', undefined],
  ])('does not unlink %s', async (_name, account) => {
    getItem.mockResolvedValue(account);

    await destroy();

    expect(unlinkDevice).not.toHaveBeenCalled();
    expect(calls).toContain('stopClient');
  });

  test('only closing the connections keeps the device linked', async () => {
    getItem.mockResolvedValue(LINKED);

    await destroy(true);

    expect(unlinkDevice).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });
});
