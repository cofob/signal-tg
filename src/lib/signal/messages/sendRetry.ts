import type { ConversationRecord, MessageRecord, SendRetry } from '../db/MessageDb';

import { getFailedRecipients } from './sendState';

type SendRetryFields = Pick<MessageRecord, 'recipientStatus' | 'recipientErrors'>;
type SendRetryConversation = Pick<ConversationRecord, 'type' | 'memberAcis'>;

// Signal Desktop `ts/util/exponentialBackoff.std.ts`
const BACKOFF_FACTOR = 1.9;
const MAX_BACKOFF_MS = 15 * 60 * 1000;
const FIRST_BACKOFFS_MS = [0, 190];
// Signal Desktop `MAX_RETRY_TIME` in `ts/jobs/conversationJobQueue.preload.ts`
export const SEND_RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The pause before send number `attempt` (counting from 1), as in Signal Desktop `exponentialBackoffSleepTime`: none
 * before the first, then growing by a factor up to a quarter of an hour
 */
export function getSendRetryDelay(attempt: number) {
  if (attempt <= FIRST_BACKOFFS_MS.length) return FIRST_BACKOFFS_MS[attempt - 1];
  const lastBackoff = FIRST_BACKOFFS_MS[FIRST_BACKOFFS_MS.length - 1];
  const exponent = attempt - FIRST_BACKOFFS_MS.length + 1;
  return Math.min(MAX_BACKOFF_MS, (lastBackoff / BACKOFF_FACTOR) * BACKOFF_FACTOR ** exponent);
}

/**
 * The recipients an automatic resend goes to: those still pending after a restart and those that failed for lack of
 * a connection. Other failures need the user (`getFailedRecipients`); people who left the group are left out.
 */
export function getRetryRecipients(message: SendRetryFields, conversation: SendRetryConversation) {
  const resendable = new Set(getFailedRecipients(message, conversation));
  return Object.entries(message.recipientStatus ?? {})
    .filter(([aci, status]) => (
      status === 'pending' && !(conversation.type === 'group' && conversation.memberAcis?.includes(aci) === false)
    ) || (resendable.has(aci) && message.recipientErrors?.[aci] === 'network'))
    .map(([aci]) => aci);
}

/** The retry state after a send ended: absent when no recipient is left for another one */
export function getNextSendRetry(
  previous: SendRetry | undefined, message: SendRetryFields, conversation: SendRetryConversation,
): SendRetry | undefined {
  if (!getRetryRecipients(message, conversation).length) return undefined;

  const attempt = (previous?.attempt ?? 0) + 1;
  const now = Date.now();
  return { startedAt: previous?.startedAt ?? now, attempt, at: now + getSendRetryDelay(attempt + 1) };
}
