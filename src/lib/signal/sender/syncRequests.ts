import type { SenderContext } from './sendContent';

import { getRandomBytes } from '../crypto';
import { sendContent } from './sendContent';

import { SyncMessage_Request_Type } from '../proto/generated/SignalService';

const MAX_PADDING_LENGTH = 512;

/**
 * Asks the primary device for contacts, configuration and the blocked list after linking
 * (Signal Desktop `ts/textsecure/syncRequests.preload.ts`); `KEYS` is added when the provisioning
 * message had no account entropy pool.
 */
export async function sendInitialSyncRequests(context: SenderContext) {
  const types = [
    SyncMessage_Request_Type.CONTACTS,
    SyncMessage_Request_Type.CONFIGURATION,
    SyncMessage_Request_Type.BLOCKED,
  ];
  if (!context.account.accountEntropyPool) types.push(SyncMessage_Request_Type.KEYS);

  for (const type of types) {
    await sendContent(context, context.account.aci, {
      syncMessage: { request: { type }, padding: getRandomPadding() },
    }, { timestamp: Date.now(), isUrgent: false });
  }
}

/** Sync messages carry random padding so their size does not reveal their kind */
function getRandomPadding() {
  const [length] = crypto.getRandomValues(new Uint16Array(1));
  return getRandomBytes((length % MAX_PADDING_LENGTH) + 1);
}
