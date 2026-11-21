import type { ApiSignalDevices } from '../../types';

import { DEBUG } from '../../../config';
import {
  addLinkedDevice,
  DeviceLinkError,
  fetchLinkedDevices,
  parseDeviceLinkUrl,
  removeLinkedDevice,
} from '../../../lib/signal/account/linkedDevices';
import { SIGNAL_PRIMARY_DEVICE_ID } from '../../../lib/signal/config';
import { client, logError, store } from '../engine';

/**
 * The devices of the account as the server lists them. A primary device links and unlinks devices; a linked
 * device only sees the list. `undefined` when the list could not be loaded.
 */
export async function fetchSignalDevices(): Promise<ApiSignalDevices | undefined> {
  try {
    // A demo account never connects; its seed has the devices to show
    const account = await store.getItem('account');
    const demoDevices = account?.isDemo && DEBUG ? await store.getItem('demoDevices') : undefined;
    if (account && demoDevices) {
      return {
        isPrimary: account.deviceId === SIGNAL_PRIMARY_DEVICE_ID,
        currentDeviceId: account.deviceId,
        devices: demoDevices,
      };
    }

    const context = client.getSenderContext();
    const devices = await fetchLinkedDevices(context);
    return {
      isPrimary: context.account.deviceId === SIGNAL_PRIMARY_DEVICE_ID,
      currentDeviceId: context.account.deviceId,
      devices,
    };
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/** Whether this is the primary device, from the local account, so that it needs no connection */
export async function fetchIsSignalPrimary() {
  const account = await store.getItem('account');
  return account?.deviceId === SIGNAL_PRIMARY_DEVICE_ID;
}

/**
 * Links the device of a `sgnl://linkdevice` QR code to this account; only a primary device can. Resolves with the
 * new device once it registered, `{ isPending }` when it did not in time, or the reason it failed.
 */
export async function linkSignalDevice(url: string) {
  const target = parseDeviceLinkUrl(url);
  if (!target) return { error: 'badCode' as const };

  try {
    const context = client.getSenderContext();
    if (context.account.deviceId !== SIGNAL_PRIMARY_DEVICE_ID) return { error: 'network' as const };
    const device = await addLinkedDevice(context, target);
    return device ? { device } : { isPending: true as const };
  } catch (err) {
    if (err instanceof DeviceLinkError) return { error: err.reason };
    logError(err);
    return { error: 'network' as const };
  }
}

/** Unlinks a device of a primary device; resolves with `true` once it is gone */
export async function unlinkSignalDevice(deviceId: number) {
  try {
    const context = client.getSenderContext();
    if (context.account.deviceId !== SIGNAL_PRIMARY_DEVICE_ID || deviceId === context.account.deviceId) {
      return undefined;
    }
    await removeLinkedDevice(context, deviceId);
    return true as const;
  } catch (err) {
    logError(err);
    return undefined;
  }
}
