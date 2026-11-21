import * as cacheApi from '../../util/cacheApi';
import { ATTACHMENT_CACHE_NAME } from './attachments/attachmentCache';

import MessageDb from './db/MessageDb';
import SignalStore from './store/SignalStore';

/**
 * Removes the account, keys, messages and decrypted attachments of the engine from this browser, from any context and
 * without a running engine. Logging out has to work while the engine is not started, such as on the lock screen of a
 * passcode, where the worker's `destroy` does not run.
 */
export default async function clearSignalLocalData() {
  await Promise.all([
    new SignalStore().clear(),
    new MessageDb().clear(),
    cacheApi.clear(ATTACHMENT_CACHE_NAME),
  ]);
}
