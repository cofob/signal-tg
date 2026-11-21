import type { ConversationRecord } from '../db/MessageDb';
import type { AccountRecord, StoryDistributionList } from '../store/SignalStore';

// Signal Desktop `MY_STORY_ID` in `ts/types/Stories.std.ts`: the identifier of My Story is the nil UUID
export const MY_STORY_ID = '00000000-0000-0000-0000-000000000000';
// Stories expire a day after they are sent (Signal Desktop `handleStoryMessage`)
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * When a story expires: a day after it was sent, but at most a day from now, so that a sender whose clock is ahead
 * cannot keep it longer (Signal Desktop `MessageReceiver.#handleStoryMessage`). Stories follow the device clock there
 * too, as the engine has no source of server time.
 */
export function getStoryExpiresAt(sentAt: number) {
  return Math.min(sentAt, Date.now()) + STORY_LIFETIME_MS;
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
 * Stories carry our profile key, so they never go to blocked contacts or to people who have not been accepted. A
 * member that the list names by PNI only (`otherMemberIds`) cannot be matched with a conversation, which has no PNI:
 * the primary device writes a member by ACI as soon as it knows it, so this device sends to such a person until the
 * list is rewritten.
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
