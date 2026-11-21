import type { ApiUser } from '../../types';

import { keyTransparency, logError } from '../engine';
import { getConversationByPeerId } from '../peers';

/**
 * Checks the identity key of a contact against the key transparency log: `ok` when the log lists it, `fail` when it
 * does not or the log could not be reached, `unavailable` for a contact that we do not know by phone number
 */
export async function checkKeyTransparency({ user }: { user: ApiUser }) {
  const conversation = await getConversationByPeerId(user.id);
  if (conversation?.type !== 'private' || !await keyTransparency.isContactAvailable(conversation.id)) {
    return 'unavailable' as const;
  }

  try {
    await keyTransparency.checkContact(conversation.id);
    return 'ok' as const;
  } catch (err) {
    logError(err);
    return 'fail' as const;
  }
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
