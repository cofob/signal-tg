import type { MessageChanges } from '../../../lib/signal/messages/MessageProcessor';
import type { ApiCallLogEntry } from '../../types';

import { buildApiCallLogEntry } from '../builders/calls';
import { db, processor } from '../engine';
import { sendApiUpdate } from '../updates';

// The call log shows the latest calls only
export const CALL_LOG_LIMIT = 200;

/** Sends the call log again when calls changed: it is short, so the app replaces its list */
export async function handleCallChanges({ calls }: MessageChanges) {
  if (!calls.length) return;
  sendApiUpdate({ '@type': 'updateCallLog', entries: await buildCallLog() });
}

export async function buildCallLog(): Promise<ApiCallLogEntry[]> {
  const entries: ApiCallLogEntry[] = [];
  for (const call of await processor.getCallLog(CALL_LOG_LIMIT)) {
    const conversation = await db.getConversation(call.peerId);
    if (conversation) entries.push(buildApiCallLogEntry(call, conversation));
  }
  return entries;
}
