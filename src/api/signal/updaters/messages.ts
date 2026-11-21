import type { MessageChanges, TypingEvent } from '../../../lib/signal/messages/MessageProcessor';
import type { ApiMessage, ApiUpdate } from '../../types';

import { buildCollectionByKey } from '../../../util/iteratees';
import { getServerTime } from '../../../util/serverTime';
import {
  buildApiMessageWithPoll, createUserResolver, getIsMessageHidden,
} from '../builders/messages';
import { db, logError } from '../engine';
import { getPeerId, getUserPeerId } from '../peers';
import { sendApiUpdate } from '../updates';

// Signal Desktop `ts/models/conversations.preload.ts` (`notifyTyping`)
const TYPING_TIMEOUT_MS = 15 * 1000;
// The app clears a typing status 6 s after its last update, so a status that lasts is sent again sooner
const TYPING_REFRESH_MS = 5 * 1000;

type Typing = { lastStartedAt: number; timer: ReturnType<typeof setInterval> };

// Local messages of sends from this device, by the id of the stored message that replaces them
const localMessagesById = new Map<number, ApiMessage>();
const typingByKey = new Map<string, Typing>();

/** The app shows `localMessage` until the stored message `id` replaces it through `updateMessageSendSucceeded` */
export function trackLocalMessage(id: number, localMessage: ApiMessage) {
  localMessagesById.set(id, localMessage);
}

/** Sends typing status updates; Signal clients repeat a started indicator while typing goes on */
export async function handleTyping({ conversationId, senderAci, isTyping }: TypingEvent) {
  const conversation = await db.getConversation(conversationId);
  if (!conversation) return;
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

/**
 * Sends message updates for added, changed and deleted messages. Every new message goes out as `newMessage`,
 * which the app counts as unread when it is incoming; chat read states come from the chats updater.
 */
export async function handleMessageChanges({
  conversations, messages, addedMessageIds, deletedMessages,
}: MessageChanges) {
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const users = createUserResolver();
  const updates: ApiUpdate[] = [];
  const deletedIdsByChatId = new Map<string, number[]>();

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

    // A message that cannot be built stays out of the app, which still gets the rest of the batch
    let built: Awaited<ReturnType<typeof buildApiMessageWithPoll>>;
    try {
      built = await buildApiMessageWithPoll(message, conversation, users);
    } catch (err) {
      logError(err);
      continue;
    }
    const { message: apiMessage, poll, webPage } = built;
    const webPages = webPage && [webPage];
    const localMessage = localMessagesById.get(message.id);
    if (localMessage) {
      localMessagesById.delete(message.id);
      updates.push({
        '@type': 'updateMessageSendSucceeded', chatId, localId: localMessage.id, message: apiMessage, poll,
      });
    } else if (addedMessageIds.includes(message.id)) {
      updates.push({
        '@type': 'newMessage', chatId, id: message.id, message: apiMessage, poll, webPages,
      });
      // A message ends the typing indicator of its sender
      if (!message.isOutgoing && apiMessage.senderId) stopTyping(chatId, apiMessage.senderId);
    } else {
      updates.push({
        '@type': 'updateMessage', chatId, id: message.id, message: apiMessage, poll, webPages, isFull: true,
      });
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
  deletedIdsByChatId.forEach((ids, chatId) => sendApiUpdate({ '@type': 'deleteMessages', chatId, ids }));
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
