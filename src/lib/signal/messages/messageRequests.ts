import type { ConversationRecord } from '../db/MessageDb';

/**
 * Whether a conversation is past the message request (Signal Desktop `ts/util/isConversationAccepted.preload.ts`):
 * Note to Self, a conversation we accepted, wrote to or share our profile with, someone from the phone's contacts,
 * or a private conversation without messages. The member who added us to a group is not known here, so a group
 * stays a request until we accept it, write to it or the storage service lists it as whitelisted.
 */
export function getIsConversationAccepted(conversation: ConversationRecord, selfAci: string) {
  if (conversation.id === selfAci || conversation.isAccepted) return true;
  if (conversation.type === 'group') return false;
  return Boolean(conversation.systemName) || conversation.lastMessageId === undefined;
}
