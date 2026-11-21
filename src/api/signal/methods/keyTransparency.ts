import type { ApiUser } from '../../types';

import { isUnfinishedCheck } from '../../../lib/signal/keytrans/KeyTransparency';
import { keyTransparency, logError } from '../engine';
import { getConversationByPeerId } from '../peers';

// A result is reused for this long, so opening the safety number screen again does not repeat the requests
const RESULT_LIFETIME_MS = 5 * 60 * 1000;

const results = new Map<string, { status: 'ok' | 'fail'; at: number }>();
const controllers = new Map<string, AbortController>();

/**
 * Checks the identity key of a contact against the key transparency log: `ok` when the log lists it, `fail` when it
 * does not, `error` when the check could not finish, `unavailable` for a contact that we do not know by phone number
 */
export async function checkKeyTransparency({ user }: { user: ApiUser }) {
  const conversation = await getConversationByPeerId(user.id);
  if (conversation?.type !== 'private' || !await keyTransparency.isContactAvailable(conversation.id)) {
    return 'unavailable' as const;
  }

  const aci = conversation.id;
  const result = results.get(aci);
  if (result && Date.now() - result.at < RESULT_LIFETIME_MS) return result.status;

  controllers.get(aci)?.abort();
  const controller = new AbortController();
  controllers.set(aci, controller);
  try {
    await keyTransparency.checkContact(aci, controller.signal);
    results.set(aci, { status: 'ok', at: Date.now() });
    return 'ok' as const;
  } catch (err) {
    if (isUnfinishedCheck(err)) return 'error' as const;
    logError(err);
    results.set(aci, { status: 'fail', at: Date.now() });
    return 'fail' as const;
  } finally {
    if (controllers.get(aci) === controller) controllers.delete(aci);
  }
}

/** Stops the check of a contact when its safety number screen closes */
export async function cancelKeyTransparencyCheck({ user }: { user: ApiUser }) {
  const conversation = await getConversationByPeerId(user.id);
  if (conversation) controllers.get(conversation.id)?.abort();
}

/** The result of the last check of our own account */
export function fetchKeyTransparencySelfStatus() {
  return keyTransparency.getSelfStatus();
}

/** Checks our own account against the log, and returns the status afterwards */
export async function checkKeyTransparencySelf() {
  await keyTransparency.selfCheck().catch(logError);
  return keyTransparency.getSelfStatus();
}
