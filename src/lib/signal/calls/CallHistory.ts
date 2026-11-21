import type MessageDb from '../db/MessageDb';
import type { CallRecord, ConversationRecord, MessageRecord, NewMessageRecord } from '../db/MessageDb';
import type {
  CallEventDetails, CallLogEventDetails, CallLogEventTarget,
} from './callDisposition';

import {
  findCallForLogEvent, getCallIdFromEra, getIsCallDeleted, getIsCallUnseen, transitionCall,
} from './callDisposition';

/** What call history needs of `MessageProcessor`, which serializes the changes of messages */
export type CallHistoryHost = {
  db: MessageDb;
  addMessage(conversation: ConversationRecord, record: NewMessageRecord): Promise<{ message: MessageRecord }>;
  putMessage(record: MessageRecord): Promise<unknown>;
  removeMessage(message: MessageRecord): Promise<void>;
  // Points the conversation at its latest remaining message after a call notice was removed
  updateLastMessage(conversationId: string): Promise<unknown>;
  // The call is added to the changes that the app is told about
  addChangedCall(call: CallRecord): void;
};

/**
 * Applies a `CallEvent` sync message of another device (Signal Desktop `updateCallHistoryFromRemoteEvent` in
 * `ts/util/callDisposition.preload.ts`): the call moves to its next status, and its notice in the chat is added or
 * updated. Calls of conversations that are not here are dropped, as Desktop does.
 */
export async function applyCallEvent(host: CallHistoryHost, event: CallEventDetails) {
  const conversation = await host.db.getConversation(event.peerId);
  if (!conversation) return;
  const previous = await host.db.getCall(event.peerId, event.callId);
  const next = transitionCall(previous, event);
  if (next) await saveCall(host, conversation, previous, next);
}

/**
 * Applies a group call update, a data message with the era of a call that started in the group (Desktop
 * `updateLocalHistoryFromGroupCallUpdateMessage`): a call not in the history yet is added when `canCreate`, and a
 * call that is there takes an earlier time of the update
 */
export async function applyGroupCallUpdate(
  host: CallHistoryHost, conversation: ConversationRecord, eraId: string, timestamp: number, canCreate: boolean,
) {
  if (conversation.type !== 'group' || conversation.groupState?.isTerminated || !eraId) return;

  const callId = await getCallIdFromEra(eraId);
  const previous = await host.db.getCall(conversation.id, callId);
  if (previous) {
    if (timestamp < previous.timestamp) await saveCall(host, conversation, previous, { ...previous, timestamp });
    return;
  }
  if (!canCreate) return;

  // Group call updates do not say who started the call, so it is incoming until a sync message says otherwise
  const next = transitionCall(undefined, {
    callId, peerId: conversation.id, mode: 'group', type: 'group', direction: 'incoming', timestamp, event: 'started',
  });
  if (next) await saveCall(host, conversation, undefined, next);
}

/**
 * Applies a `CallLogEvent` sync message (Desktop `ts/util/onCallLogEventSync.preload.ts`): clearing the call log, or
 * marking calls as seen
 */
export async function applyCallLogEvent(host: CallHistoryHost, { type, target, isRoom }: CallLogEventDetails) {
  // Calls to call links are not kept
  if (isRoom) return;
  if (type === 'clear') {
    await clearCallsUpTo(host, target);
  } else {
    await markCallsSeen(host, target, type === 'markedAsReadInConversation');
  }
}

/** Clears the whole call log, as the user asks; returns the newest call that was cleared, which the sync names */
export async function clearCallLog(host: CallHistoryHost) {
  const [newest] = await host.db.getCallLog(1);
  if (newest) await clearCallsUpTo(host, { peerId: newest.peerId, callId: newest.callId, timestamp: newest.timestamp });
  return newest;
}

/**
 * Deletes the calls up to the target call: they stay as deleted calls with the time of the deletion, so that late
 * events do not bring them back (Desktop `clearCallHistory` in `ts/sql/Server.node.ts`)
 */
async function clearCallsUpTo(host: CallHistoryHost, target: CallLogEventTarget) {
  const calls = await host.db.getCalls();
  const targetCall = findCallForLogEvent(calls, target);
  if (!targetCall) return;

  const deletedAt = Date.now();
  const conversationIds = new Set<string>();
  for (const call of calls) {
    if (getIsCallDeleted(call) || call.timestamp > targetCall.timestamp) continue;
    await removeCallMessage(host, call);
    conversationIds.add(call.peerId);
    await putCall(host, {
      callId: call.callId,
      peerId: call.peerId,
      mode: call.mode,
      type: call.type,
      direction: call.direction,
      status: 'deleted',
      timestamp: deletedAt,
    });
  }
  for (const conversationId of conversationIds) await host.updateLastMessage(conversationId);
}

/** Marks the unseen calls up to the target call as seen, in its conversation only if `isInConversation` */
async function markCallsSeen(host: CallHistoryHost, target: CallLogEventTarget, isInConversation: boolean) {
  const calls = await host.db.getCalls();
  const targetCall = findCallForLogEvent(calls, target);
  if (!targetCall) return;

  for (const call of calls) {
    if (!call.isUnseen || call.timestamp > targetCall.timestamp) continue;
    if (isInConversation && call.peerId !== targetCall.peerId) continue;
    await putCall(host, { ...call, isUnseen: undefined });
  }
}

/**
 * Stores the call and its notice in the chat (Desktop `saveCallHistory`): the first event adds the notice, later
 * ones update it in place, so it stays where it arrived; a deleted call removes it
 */
async function saveCall(
  host: CallHistoryHost, conversation: ConversationRecord, previous: CallRecord | undefined, next: CallRecord,
) {
  if (getIsCallDeleted(next)) {
    if (previous) await removeCallMessage(host, previous);
    await putCall(host, { ...next, messageId: undefined, isUnseen: undefined });
    await host.updateLastMessage(conversation.id);
    return;
  }

  // Calls that were seen stay seen
  const call: CallRecord = {
    ...next,
    isUnseen: getIsCallUnseen(next) && (!previous || previous.isUnseen) ? true : undefined,
  };
  const existing = previous?.messageId === undefined ? undefined : await host.db.getMessage(previous.messageId);
  if (existing) {
    call.messageId = existing.id;
    await host.putMessage({
      ...existing,
      isOutgoing: call.direction === 'outgoing',
      actorAci: call.ringerId,
    });
  } else {
    const { message } = await host.addMessage(conversation, {
      conversationId: conversation.id,
      kind: 'call',
      // A notice has no author, so that it never matches a lookup by author and timestamp
      authorAci: '',
      actorAci: call.ringerId,
      callId: call.callId,
      sentAt: call.timestamp,
      receivedAt: Date.now(),
      isOutgoing: call.direction === 'outgoing',
    });
    call.messageId = message.id;
  }
  await putCall(host, call);
}

async function removeCallMessage(host: CallHistoryHost, { messageId }: CallRecord) {
  const message = messageId === undefined ? undefined : await host.db.getMessage(messageId);
  if (message) await host.removeMessage(message);
}

async function putCall(host: CallHistoryHost, call: CallRecord) {
  await host.db.putCall(call);
  host.addChangedCall(call);
}
