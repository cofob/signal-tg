import type { ConversationRecord } from '../db/MessageDb';
import type { AccountRecord, StoryDistributionList } from '../store/SignalStore';

// Signal Desktop `MY_STORY_ID` in `ts/types/Stories.std.ts`: the identifier of My Story is the nil UUID
export const MY_STORY_ID = '00000000-0000-0000-0000-000000000000';
// Stories expire a day after they are sent (Signal Desktop `handleStoryMessage`)
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * My Story as the storage service has it, or as Signal Android creates it: all connections, with replies.
 * The primary device writes the list; until it does, this device sends with the defaults.
 */
export function getMyStoryList(lists: StoryDistributionList[]): StoryDistributionList {
  return lists.find(({ id }) => id === MY_STORY_ID) ?? {
    id: MY_STORY_ID, name: '', memberAcis: [], areRepliesAllowed: true, isBlockList: true,
  };
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
 * The people a list story goes to: for My Story as a block list, every connection the list does not name
 * (Signal Desktop `sendStoryMessage` in `ts/util/sendStoryMessage.preload.ts`)
 */
export function getStoryListRecipientAcis(
  list: StoryDistributionList, conversations: ConversationRecord[], selfAci: string,
) {
  if (list.id === MY_STORY_ID && list.isBlockList) {
    const excluded = new Set(list.memberAcis);
    return conversations
      .filter((conversation) => getIsSignalConnection(conversation, selfAci) && !excluded.has(conversation.id))
      .map(({ id }) => id);
  }
  const blocked = new Set(conversations.filter(({ isBlocked }) => isBlocked).map(({ id }) => id));
  return list.memberAcis.filter((aci) => aci !== selfAci && !blocked.has(aci));
}

/**
 * Signal Desktop `areStoryViewReceiptsEnabled` in `ts/util/Settings.preload.ts`: without a setting of their own,
 * story view receipts follow read receipts
 */
export function getAreStoryViewReceiptsEnabled(account: AccountRecord) {
  return account.isStoryViewReceiptsEnabled ?? Boolean(account.isReadReceiptsEnabled);
}
