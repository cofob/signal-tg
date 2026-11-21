import type { ConversationRecord } from '../db/MessageDb';
import type { AccountRecord, StoryDistributionList } from '../store/SignalStore';

import { getServerTimeOffset } from '../../../util/serverTime';

// Signal Desktop `MY_STORY_ID` in `ts/types/Stories.std.ts`: the identifier of My Story is the nil UUID
export const MY_STORY_ID = '00000000-0000-0000-0000-000000000000';
// Stories expire a day after they are sent (Signal Desktop `handleStoryMessage`)
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MS_PER_SECOND = 1000;

/** The time on the server's clock in milliseconds, which story expiry follows; `getServerTime` has seconds only */
export function getStoryTime() {
  return Date.now() + getServerTimeOffset() * MS_PER_SECOND;
}

/**
 * When a story expires: a day after the earliest of its send time, the time the server received it and now, so that
 * a sender whose clock is ahead cannot keep it longer
 */
export function getStoryExpiresAt(sentAt: number, serverTimestamp?: number) {
  return Math.min(sentAt, serverTimestamp ?? sentAt, getStoryTime()) + STORY_LIFETIME_MS;
}

/**
 * People a story may reach without being in a list: accepted private conversations and system contacts that are
 * not blocked (Signal Desktop `isSignalConnection` in `ts/util/getSignalConnections.preload.ts`)
 */
export function getIsSignalConnection(conversation: ConversationRecord, selfAci: string) {
  return conversation.type === 'private' && conversation.id !== selfAci && !conversation.isBlocked
    && Boolean(conversation.isAccepted || conversation.systemName);
}

/**
 * The people a list story goes to: for My Story as a block list, every connection the list does not name (Signal
 * Desktop `sendStoryMessage` in `ts/util/sendStoryMessage.preload.ts`); otherwise the members that are connections.
 * Stories carry our profile key, so they never go to blocked contacts or to people who have not been accepted.
 */
export function getStoryListRecipientAcis(
  list: StoryDistributionList, conversations: ConversationRecord[], selfAci: string,
) {
  const connectionAcis = conversations
    .filter((conversation) => getIsSignalConnection(conversation, selfAci))
    .map(({ id }) => id);
  if (list.id === MY_STORY_ID && list.isBlockList) {
    const excluded = new Set(list.memberAcis);
    return connectionAcis.filter((aci) => !excluded.has(aci));
  }
  const connections = new Set(connectionAcis);
  return list.memberAcis.filter((aci) => connections.has(aci));
}

/**
 * Signal Desktop `areStoryViewReceiptsEnabled` in `ts/util/Settings.preload.ts`: without a setting of their own,
 * story view receipts follow read receipts
 */
export function getAreStoryViewReceiptsEnabled(account: AccountRecord) {
  return account.isStoryViewReceiptsEnabled ?? Boolean(account.isReadReceiptsEnabled);
}
