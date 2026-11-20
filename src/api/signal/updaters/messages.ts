import type { ConversationRecord } from '../../../lib/signal/db/MessageDb';
import type { MessageChanges, TypingEvent } from '../../../lib/signal/messages/MessageProcessor';
import type { ApiMessage, ApiUpdate } from '../../types';
import { MAIN_THREAD_ID } from '../../types';

import { buildCollectionByKey } from '../../../util/iteratees';
import { getServerTime } from '../../../util/serverTime';
import {
  buildApiMessageWithPoll, createUserResolver, getIsMessageHidden, getIsOutgoingMessageRead,
} from '../builders/messages';
import { getCurrentAccount } from '../client';
import { db } from '../engine';
import { getPeerId, getUserPeerId } from '../peers';
import { sendApiUpdate } from '../updates';

// Signal Desktop `ts/models/conversations.preload.ts` (`notifyTyping`)
const TYPING_TIMEOUT_MS = 15 * 1000;
// The app clears a typing status 6 s after its last update, so a status that lasts is sent again sooner
const TYPING_REFRESH_MS = 5 * 1000;
// How many of the latest messages `reportLastReadOutbox` looks through
const READ_OUTBOX_SCAN_LIMIT = 100;

type Typing = { lastStartedAt: number; timer: ReturnType<typeof setInterval> };

// Local messages of sends from this device, by the id of the stored message that replaces them
const localMessagesById = new Map<number, ApiMessage>();
const lastReadOutboxIdByChatId = new Map<string, number>();
const typingByKey = new Map<string, Typing>();
let updateQueue = Promise.resolve();

/** The app shows `localMessage` until the stored message `id` replaces it through `updateMessageSendSucceeded` */
export function trackLocalMessage(id: number, localMessage: ApiMessage) {
  localMessagesById.set(id, localMessage);
}

/** Sends message updates for added, changed and deleted messages, in the order the changes happened */
export function handleMessageChanges(changes: MessageChanges) {
  const result = updateQueue.then(() => sendMessageUpdates(changes));
  updateQueue = result.catch(() => undefined);
  return result;
}

/**
 * Tells the app the latest outgoing message of a conversation that a recipient read, once per conversation;
 * message changes keep it current afterwards
 */
export async function reportLastReadOutbox(conversation: ConversationRecord) {
  const chatId = getPeerId(conversation);
  if (lastReadOutboxIdByChatId.has(chatId)) return;
  const messages = await db.getMessages(conversation.id, READ_OUTBOX_SCAN_LIMIT);
  const lastRead = messages.find(getIsOutgoingMessageRead);
  if (lastRead) sendLastReadOutbox(chatId, lastRead.id);
}

/** Sends typing status updates; Signal clients repeat a started indicator while typing goes on */
export async function handleTyping({ conversationId, senderAci, isTyping }: TypingEvent) {
  const conversation = await db.getConversation(conversationId);
  if (!conversation || getCurrentAccount()?.isTypingIndicatorsEnabled === false) return;
  // Members who cannot write to an announcement-only group do not show typing (Signal Desktop)
  if (conversation.isAnnouncementsOnly && !conversation.adminAcis?.includes(senderAci)) return;

  const chatId = getPeerId(conversation);
  const peerId = await getUserPeerId(senderAci);
  if (isTyping) {
    startTyping(chatId, peerId);
  } else {
    stopTyping(chatId, peerId);
  }
}

async function sendMessageUpdates({
  conversations, messages, addedMessageIds, deletedMessages,
}: MessageChanges) {
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const users = createUserResolver();
  const updates: ApiUpdate[] = [];
  const deletedIdsByChatId = new Map<string, number[]>();
  const readOutboxIdByChatId = new Map<string, number>();

  for (const message of messages) {
    const conversation = conversationsById.get(message.conversationId)
      ?? await db.getConversation(message.conversationId);
    if (!conversation) continue;
    conversationsById.set(conversation.id, conversation);
    const chatId = getPeerId(conversation);

    if (getIsMessageHidden(message)) {
      deletedIdsByChatId.set(chatId, [...deletedIdsByChatId.get(chatId) ?? [], message.id]);
      continue;
    }

    const { message: apiMessage, poll } = await buildApiMessageWithPoll(message, conversation, users);
    const localMessage = localMessagesById.get(message.id);
    if (localMessage) {
      localMessagesById.delete(message.id);
      updates.push({
        '@type': 'updateMessageSendSucceeded', chatId, localId: localMessage.id, message: apiMessage, poll,
      });
    } else if (addedMessageIds.includes(message.id)) {
      updates.push({
        '@type': 'newMessage', chatId, id: message.id, message: apiMessage, poll,
      });
      // A message ends the typing indicator of its sender
      if (!message.isOutgoing && apiMessage.senderId) stopTyping(chatId, apiMessage.senderId);
    } else {
      updates.push({
        '@type': 'updateMessage', chatId, id: message.id, message: apiMessage, poll, isFull: true,
      });
    }

    if (getIsOutgoingMessageRead(message)) {
      readOutboxIdByChatId.set(chatId, Math.max(readOutboxIdByChatId.get(chatId) ?? 0, message.id));
    }
  }

  for (const { conversationId, id } of deletedMessages) {
    const conversation = conversationsById.get(conversationId) ?? await db.getConversation(conversationId);
    // Messages of a conversation deleted with it need no update
    if (!conversation) continue;
    conversationsById.set(conversation.id, conversation);
    const chatId = getPeerId(conversation);
    deletedIdsByChatId.set(chatId, [...deletedIdsByChatId.get(chatId) ?? [], id]);
  }

  const apiUsers = await users.buildUsers();
  if (apiUsers.length) sendApiUpdate({ '@type': 'updateEntities', users: buildCollectionByKey(apiUsers, 'id') });
  updates.forEach(sendApiUpdate);
  readOutboxIdByChatId.forEach((id, chatId) => sendLastReadOutbox(chatId, id));
  deletedIdsByChatId.forEach((ids, chatId) => sendApiUpdate({ '@type': 'deleteMessages', chatId, ids }));
}

/** The app shows outgoing messages up to the last read one as read */
function sendLastReadOutbox(chatId: string, id: number) {
  if (id <= (lastReadOutboxIdByChatId.get(chatId) ?? 0)) return;
  lastReadOutboxIdByChatId.set(chatId, id);
  sendApiUpdate({
    '@type': 'updateThreadReadState',
    chatId,
    threadId: MAIN_THREAD_ID,
    readState: { lastReadOutboxMessageId: id },
  });
}

function startTyping(chatId: string, peerId: string) {
  const key = getTypingKey(chatId, peerId);
  const current = typingByKey.get(key);
  if (current) {
    current.lastStartedAt = Date.now();
    return;
  }

  const typing: Typing = {
    lastStartedAt: Date.now(),
    timer: setInterval(() => {
      if (Date.now() - typing.lastStartedAt >= TYPING_TIMEOUT_MS) {
        stopTyping(chatId, peerId);
      } else {
        sendTypingStatus(chatId, peerId, true);
      }
    }, TYPING_REFRESH_MS),
  };
  typingByKey.set(key, typing);
  sendTypingStatus(chatId, peerId, true);
}

function stopTyping(chatId: string, peerId: string) {
  const key = getTypingKey(chatId, peerId);
  const typing = typingByKey.get(key);
  if (!typing) return;
  clearInterval(typing.timer);
  typingByKey.delete(key);
  sendTypingStatus(chatId, peerId, false);
}

function sendTypingStatus(chatId: string, peerId: string, isTyping: boolean) {
  sendApiUpdate({
    '@type': 'updateChatTypingStatus',
    id: chatId,
    peerId,
    typingStatus: isTyping ? { type: 'typing', timestamp: getServerTime() } : undefined,
  });
}

function getTypingKey(chatId: string, peerId: string) {
  return `${chatId}:${peerId}`;
}
