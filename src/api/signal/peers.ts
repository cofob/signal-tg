import type { ConversationRecord } from '../../lib/signal/db/MessageDb';

import { db, processor } from './engine';

/**
 * Peer ids of the app: private conversations are users with positive ids, groups are basic groups with
 * negative ids. Both come from the conversation's `localId`, so ids stay numeric as the UI expects.
 */
export function getPeerId(conversation: ConversationRecord) {
  return conversation.type === 'group' ? `-${conversation.localId}` : String(conversation.localId);
}

export async function getConversationByPeerId(peerId: string) {
  const localId = Math.abs(Number(peerId));
  if (!Number.isSafeInteger(localId) || !localId) return undefined;
  const conversation = await db.getConversationByLocalId(localId);
  const isGroupPeer = peerId.startsWith('-');
  return conversation && (conversation.type === 'group') === isGroupPeer ? conversation : undefined;
}

/** The user peer id of any ACI; users seen only in groups get a private conversation record here */
export async function getUserPeerId(aci: string) {
  return getPeerId(await processor.getOrCreatePrivateConversation(aci));
}
