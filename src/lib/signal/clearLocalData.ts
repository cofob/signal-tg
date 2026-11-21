import * as cacheApi from '../../util/cacheApi';
import { ATTACHMENT_CACHE_NAME } from './attachments/attachmentCache';
import { getEngineSlots } from './engineSlots';

import MessageDb from './db/MessageDb';
import SignalStore from './store/SignalStore';

/**
 * Removes the account, keys, messages and decrypted attachments of the engine in this page's account slot from
 * this browser, from any context and without a running engine. Logging out has to work while the engine is not
 * started, such as on the lock screen of a passcode, where the worker's `destroy` does not run.
 */
export default async function clearSignalLocalData() {
  await Promise.all([
    new SignalStore().clear(),
    new MessageDb().clear(),
    cacheApi.clear(ATTACHMENT_CACHE_NAME),
  ]);
}

/**
 * Removes the engine data of every account slot. The slots come from the stored sessions, which are not readable
 * while the sessions are locked, and from the databases that the browser lists.
 */
export async function clearAllSignalLocalData() {
  const slots = await getEngineSlots();
  await Promise.all([
    ...[...slots].flatMap((slot) => [new SignalStore(slot).clear(), new MessageDb(slot).clear()]),
    cacheApi.clearShared(ATTACHMENT_CACHE_NAME),
    cacheApi.clearAccountScopes(ATTACHMENT_CACHE_NAME),
  ]);
}
