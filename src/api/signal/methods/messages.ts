import type { MessageInitShape } from '@bufbuild/protobuf';
import { fromBinary } from '@bufbuild/protobuf';

import type { ConversationRecord, MessageRecord } from '../../../lib/signal/db/MessageDb';
import type { DataMessage_QuoteSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import type { ForwardMessagesParams, SendMessageParams, ThreadId } from '../../../types';
import type { MethodResponse } from '../../gramjs/methods/types';
import type {
  ApiAttachment,
  ApiChat,
  ApiFormattedText,
  ApiInputRichMessage,
  ApiMessage,
  ApiMessageEntity,
  ApiMessagePoll,
  ApiOnProgress,
  ApiPeer,
  ApiReaction,
  ApiReplyInfo,
  ApiSendMessageAction,
  MediaContent,
} from '../../types';
import { ApiMessageEntityTypes, MESSAGE_DELETED } from '../../types';

import { LOCAL_MESSAGES_LIMIT, SEND_MESSAGE_ACTION_INTERVAL } from '../../../config';
import { LONG_TEXT_CONTENT_TYPE } from '../../../lib/signal/messages/MessageProcessor';
import { DataMessage_Quote_Type, DataMessageSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import { getEmojiOnlyCountForMessage } from '../../../global/helpers/getEmojiOnlyCountForMessage';
import buildUploadingMedia from '../../../util/buildUploadingMedia';
import { buildCollectionByKey, omit, omitUndefined } from '../../../util/iteratees';
import { getServerTime } from '../../../util/serverTime';
import { buildBodyRanges } from '../builders/bodyRanges';
import {
  buildApiMessageWithPoll, createUserResolver, getIsMessageHidden,
} from '../builders/messages';
import { getCurrentAccount } from '../client';
import { db, logError, processor } from '../engine';
import { uploadMessageAttachment } from '../media';
import { getConversationByPeerId, getPeerId, getUserPeerId } from '../peers';
import { trackLocalMessage } from '../updaters/messages';
import { sendApiUpdate } from '../updates';

type DataMessageInit = MessageInitShape<typeof DataMessageSchema>;
type LocalMessage = NonNullable<Awaited<MethodResponse<'sendMessageLocal'>>>;

type OutgoingTyping = {
  refreshTimer: ReturnType<typeof setInterval>;
  pauseTimer: ReturnType<typeof setTimeout>;
};

// Signal Desktop `ts/util/longAttachment.std.ts`: longer bodies travel whole in a text attachment
const MAX_MESSAGE_BODY_BYTES = 2 * 1024;
// Signal Desktop `ts/models/conversations.preload.ts` (`bumpTyping`): a started indicator is repeated every 10 s
// and stopped 3 s after the last keystroke. The composer reports typing at most every
// `SEND_MESSAGE_ACTION_INTERVAL`, so the pause allows for that.
const TYPING_REFRESH_MS = 10 * 1000;
const TYPING_PAUSE_MS = 3 * 1000 + SEND_MESSAGE_ACTION_INTERVAL;
const SEND_ERROR = 'SIGNAL_SEND_FAILED';
const EDIT_ERROR = 'MESSAGE_EDIT_TIME_EXPIRED';
const DELETE_ERROR = 'MESSAGE_DELETE_FORBIDDEN';

let localMessageCounter = 0;
const outgoingTypingByConversationId = new Map<string, OutgoingTyping>();

/**
 * History pages with the paging of Telegram's `messages.getHistory`: messages before `offsetId`, newest first,
 * shifted toward newer ones by a negative `addOffset`. Message ids grow in arrival order across conversations.
 */
export async function fetchMessages({
  chat, offsetId, addOffset = 0, limit,
}: {
  chat: ApiChat;
  threadId?: ThreadId;
  offsetId?: number;
  isSavedDialog?: boolean;
  addOffset?: number;
  limit: number;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;

  const fromId = offsetId || Number.MAX_SAFE_INTEGER;
  const newerCount = Math.max(-addOffset, 0);
  const olderSkip = Math.max(addOffset, 0);
  const newer = newerCount ? await collectShownMessages(conversation.id, fromId, newerCount, true) : [];
  const older = await collectShownMessages(conversation.id, fromId, limit - newerCount + olderSkip, false);
  const records = [...newer.reverse(), ...older.slice(olderSkip)];

  const { messages, users } = await buildMessages(records, conversation);
  return {
    messages,
    users,
    chats: [],
    count: await db.countMessages(conversation.id),
    topics: [],
  };
}

export async function fetchMessage({ chat, messageId }: { chat: ApiChat; messageId: number }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;
  const record = await db.getMessage(messageId);
  if (!record || record.conversationId !== conversation.id || getIsMessageHidden(record)) return MESSAGE_DELETED;
  const { messages: [message] } = await buildMessages([record], conversation);
  return { message };
}

export async function fetchMessagesById({ chat, messageIds }: { chat: ApiChat; messageIds: number[] }) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;
  const records = await Promise.all(messageIds.map((id) => db.getMessage(id)));
  const shown = records.filter((record): record is MessageRecord => (
    record?.conversationId === conversation.id && !getIsMessageHidden(record)
  ));
  return (await buildMessages(shown, conversation)).messages;
}

/** Shows the message being sent until the stored message replaces it */
export function sendMessageLocal(params: SendMessageParams) {
  const {
    chat, lastMessageId, text, entities, replyInfo, attachment, poll, wasDrafted,
  } = params;
  if (!chat) return undefined;

  const localPoll: ApiMessagePoll | undefined = poll && { mediaType: 'poll', summary: poll.summary, results: {} };
  const media = attachment ? buildUploadingMedia(attachment) : {};
  // The GramJS result type is the literal type of its local message builder, which the app reads as `ApiMessage`
  return showLocalMessage(chat, lastMessageId, {
    ...media,
    text: text ? { text, entities } : undefined,
    pollId: localPoll?.summary.id,
  }, {
    replyInfo: replyInfo?.type === 'message' ? { type: 'message', replyToMsgId: replyInfo.replyToMsgId } : undefined,
    poll: localPoll,
    wasDrafted,
  }) as Promise<LocalMessage>;
}

/**
 * Sends text with formatting and mentions, a reply, one attachment or a poll. Albums go as one message per
 * attachment, and content Signal has no counterpart for fails.
 */
export async function sendMessage(params: SendMessageParams, onProgress?: ApiOnProgress) {
  const localMessage = params.localMessage ?? await sendMessageLocal(params);
  if (!localMessage) return;

  const conversation = await getConversationByPeerId(localMessage.chatId);
  if (!conversation) {
    markLocalMessageFailed(localMessage);
    return;
  }
  clearOutgoingTyping(conversation.id);

  let init: DataMessageInit;
  try {
    init = await buildDataMessage(params, onProgress);
  } catch (err) {
    if (!onProgress?.isCanceled) markLocalMessageFailed(localMessage, err);
    return;
  }
  await sendWithLocalMessage(conversation, init, localMessage);
}

export async function editMessage({
  message, text, entities, richMessage, attachment,
}: {
  chat: ApiChat;
  message: ApiMessage;
  text: string;
  entities?: ApiMessageEntity[];
  richMessage?: ApiInputRichMessage;
  attachment?: ApiAttachment;
  noWebPage?: boolean;
}, onProgress?: ApiOnProgress) {
  try {
    // Signal edits change the text only
    if (richMessage || attachment) throw new Error('Only the text of a message can be edited');
    const { body, bodyRanges } = await buildOutgoingBody({ text, entities });
    const { body: inlineBody, bodyAttachment } = await prepareLongBody(body, onProgress);
    await processor.sendEditMessage(message.id, { body: inlineBody, bodyRanges, bodyAttachment });
  } catch (err) {
    logError(err);
    sendError(EDIT_ERROR);
  }
}

export async function deleteMessages({
  messageIds, shouldDeleteForAll,
}: {
  chat: ApiChat; messageIds: number[]; shouldDeleteForAll?: boolean;
}) {
  try {
    if (shouldDeleteForAll) {
      await processor.deleteForEveryone(messageIds);
    } else {
      await processor.deleteForMe(messageIds);
    }
  } catch (err) {
    logError(err);
    sendError(DELETE_ERROR);
  }
}

/** Signal keeps one reaction per person, so only the last of `reactions` counts */
export async function sendReaction({
  chat, messageId, reactions,
}: {
  chat: ApiChat;
  messageId: number;
  reactions?: ApiReaction[];
  shouldAddToRecent?: boolean;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return undefined;
  const reaction = reactions?.[reactions.length - 1];
  await processor.sendReaction(messageId, reaction?.type === 'emoji' ? reaction.emoticon : undefined);
  return true;
}

/** Everyone who reacted to a message, or with `reaction` only; Signal sends the full list with the message */
export async function fetchMessageReactionsList({
  chat, messageId, reaction,
}: {
  chat: ApiChat; messageId: number; reaction?: ApiReaction; offset?: string;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  const record = await db.getMessage(messageId);
  if (!conversation || record?.conversationId !== conversation.id) return undefined;

  const { messages: [message] } = await buildMessages([record], conversation);
  const reactions = (message.reactions?.recentReactions ?? []).filter((peerReaction) => (
    !reaction || (reaction.type === 'emoji' && peerReaction.reaction.type === 'emoji'
      && peerReaction.reaction.emoticon === reaction.emoticon)
  ));
  return { nextOffset: undefined, reactions, count: reactions.length };
}

/** Marks incoming messages read up to `maxId`, which sends read receipts and syncs */
export async function markMessageListRead({
  chat, maxId,
}: {
  chat: ApiChat; threadId: ThreadId; maxId?: number;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  if (!conversation) return;
  await processor.markRead(conversation.id, maxId || undefined).catch(logError);
}

/** Marks voice, video and view-once messages viewed after they were played or opened */
export async function markMessagesRead({ messageIds }: { chat: ApiChat; messageIds: number[] }) {
  await processor.markViewed(messageIds).catch(logError);
}

/**
 * Typing indicators as Signal Desktop sends them: started at the first keystroke and every 10 s while typing
 * goes on, stopped after a pause or when the composer is cleared
 */
export async function sendMessageAction({
  peer, action,
}: {
  peer: ApiPeer; threadId?: ThreadId; action: ApiSendMessageAction;
}) {
  const conversation = await getConversationByPeerId(peer.id);
  if (!conversation) return undefined;
  const { id } = conversation;

  if (action.type === 'typing') {
    const current = outgoingTypingByConversationId.get(id);
    if (current) clearTimeout(current.pauseTimer);
    outgoingTypingByConversationId.set(id, {
      refreshTimer: current?.refreshTimer ?? setInterval(() => sendTyping(id, true), TYPING_REFRESH_MS),
      pauseTimer: setTimeout(() => stopOutgoingTyping(id), TYPING_PAUSE_MS),
    });
    if (!current) await sendTyping(id, true);
  } else if (action.type === 'cancel' && outgoingTypingByConversationId.has(id)) {
    await stopOutgoingTyping(id);
  }
  return undefined;
}

/** Signal polls take option indexes; an empty list takes the vote back */
export async function sendPollVote({
  messageId, options,
}: {
  chat: ApiChat; messageId: number; options: string[];
}) {
  await processor.sendPollVote(messageId, options.map(Number)).catch(logError);
}

/** Voters of a poll option from the stored votes; Signal votes carry no date, and all voters come at once */
export async function loadPollOptionResults({
  chat, messageId, option,
}: {
  chat: ApiChat; messageId: number; option?: string; offset?: string; limit?: number; shouldResetVoters?: boolean;
}) {
  const conversation = await getConversationByPeerId(chat.id);
  const record = await db.getMessage(messageId);
  if (!conversation || record?.conversationId !== conversation.id) return undefined;

  const optionIndex = Number(option);
  const voters = (record.pollVotes ?? []).filter(({ optionIndexes }) => optionIndexes.includes(optionIndex));
  // Without a date the voter list shows no vote time
  const votes = await Promise.all(voters.map(async ({ authorAci }) => ({
    peerId: await getUserPeerId(authorAci), date: 0,
  })));
  return { count: votes.length, votes, nextOffset: undefined, shouldResetVoters: undefined };
}

export async function closePoll({ messageId }: { chat: ApiChat; messageId: number; poll: ApiMessagePoll }) {
  await processor.endPoll(messageId).catch(logError);
}

/** Forwarded messages show no author in Signal, so their local messages have no forward header */
export async function forwardMessagesLocal(params: ForwardMessagesParams) {
  const {
    toChat, messages, noCaptions, lastMessageId, wasDrafted,
  } = params;

  const localMessages: ApiMessage[] = [];
  for (const message of messages) {
    const hasMedia = Object.keys(omit(message.content, ['text'])).length > 0;
    const content = noCaptions && hasMedia ? omit(message.content, ['text']) : message.content;
    localMessages.push(await showLocalMessage(toChat, lastMessageId, content, { wasDrafted }));
  }
  return { messageIds: messages.map(({ id }) => id), localMessages };
}

/**
 * A forward is a new message with the content of the original; attachments keep their CDN pointers, which
 * recipients can download while the CDN keeps the file
 */
export async function forwardApiMessages(params: ForwardMessagesParams) {
  const { toChat, noCaptions, forwardedLocalMessagesSlice } = params;
  if (!forwardedLocalMessagesSlice) return;

  const { messageIds, localMessages } = forwardedLocalMessagesSlice;
  const conversation = await getConversationByPeerId(toChat.id);
  for (const [index, localMessage] of localMessages.entries()) {
    const record = await db.getMessage(messageIds[index]);
    if (!conversation || !record?.dataMessage) {
      markLocalMessageFailed(localMessage);
      continue;
    }

    const original = fromBinary(DataMessageSchema, record.dataMessage);
    const isCaptionDropped = noCaptions && original.attachments.length > 0;
    const body = isCaptionDropped ? '' : original.body;
    // Polls and other content without text, attachments, contacts or stickers are not forwarded
    if (!body && !original.attachments.length && !original.contact.length && !original.sticker) {
      markLocalMessageFailed(localMessage);
      continue;
    }

    await sendWithLocalMessage(conversation, {
      body,
      bodyRanges: isCaptionDropped ? [] : original.bodyRanges,
      attachments: original.attachments,
      contact: original.contact,
      sticker: original.sticker,
    }, localMessage);
  }
}

export async function forwardMessages(params: ForwardMessagesParams) {
  await forwardApiMessages({
    ...params,
    forwardedLocalMessagesSlice: params.forwardedLocalMessagesSlice ?? await forwardMessagesLocal(params),
  });
}

/**
 * Stores and sends a message in place of a local one; the message updater swaps them once the message is
 * stored, and recipient statuses follow as message updates
 */
async function sendWithLocalMessage(conversation: ConversationRecord, init: DataMessageInit, localMessage: ApiMessage) {
  let isStored = false;
  try {
    const sent = await processor.sendDataMessage(conversation.id, init, (stored) => {
      isStored = true;
      trackLocalMessage(stored.id, localMessage);
    });
    await reportBlockedRecipients(conversation, sent.id);
  } catch (err) {
    if (!isStored) markLocalMessageFailed(localMessage, err);
    else logError(err);
  }
}

/**
 * Asks the user about recipients whose new safety number kept the message from being sent, who can then send it
 * anyway (`sendMessageAnyway`) or check the safety number first
 */
async function reportBlockedRecipients(conversation: ConversationRecord, messageId: number) {
  const acis = await processor.getUnverifiedRecipients(messageId);
  if (!acis.length) return;

  sendApiUpdate({
    '@type': 'updateSafetyNumberBlock',
    chatId: getPeerId(conversation),
    messageId,
    userIds: await Promise.all(acis.map(getUserPeerId)),
  });
}

/** Accepts the new safety numbers of the recipients who did not get the message, and sends it to them again */
export async function sendMessageAnyway({ messageId }: { messageId: number }) {
  try {
    await processor.sendMessageAnyway(messageId);
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

async function buildDataMessage(params: SendMessageParams, onProgress?: ApiOnProgress): Promise<DataMessageInit> {
  const {
    text, entities, replyInfo, attachment, poll,
  } = params;
  const hasSupportedContent = Boolean(text || attachment || poll);
  const hasUnsupportedContent = Boolean(params.richMessage || params.sticker || params.gif || params.audio
    || params.contact || params.story || params.todo || params.dice);
  if (!hasSupportedContent || hasUnsupportedContent) throw new Error('Signal has no counterpart for this content');

  // A Signal poll has no description
  const { body, bodyRanges } = text && !poll
    ? await buildOutgoingBody({ text, entities })
    : { body: '', bodyRanges: [] };
  const { body: inlineBody, bodyAttachment } = await prepareLongBody(body);
  const attachments = attachment ? [await uploadMessageAttachment(attachment, onProgress)] : [];
  if (bodyAttachment) attachments.push(bodyAttachment);

  return {
    body: inlineBody,
    bodyRanges,
    attachments,
    quote: replyInfo?.type === 'message' ? await buildQuote(replyInfo.replyToMsgId) : undefined,
    isViewOnce: attachment?.ttlSeconds ? true : undefined,
    pollCreate: poll ? {
      question: poll.summary.question.text,
      allowMultiple: poll.summary.isMultipleChoice,
      options: poll.summary.answers.map((answer) => answer.text.text),
    } : undefined,
  };
}

/** Mention entities of users become Signal mentions by ACI */
async function buildOutgoingBody(text: ApiFormattedText) {
  const aciByUserId = new Map<string, string>();
  for (const entity of text.entities ?? []) {
    if (entity.type !== ApiMessageEntityTypes.MentionName) continue;
    const conversation = await getConversationByPeerId(entity.userId);
    if (conversation?.type === 'private') aciByUserId.set(entity.userId, conversation.id);
  }
  return buildBodyRanges(text, (entity) => (
    entity.type === ApiMessageEntityTypes.MentionName ? aciByUserId.get(entity.userId) : undefined
  ));
}

/**
 * A body over `MAX_MESSAGE_BODY_BYTES` in UTF-8 travels whole as a `LONG_TEXT_CONTENT_TYPE` attachment, and the
 * inline body keeps the whole graphemes that fit (Signal Desktop `ts/util/longAttachment.std.ts`)
 */
async function prepareLongBody(body: string, onProgress?: ApiOnProgress) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  if (bytes.length <= MAX_MESSAGE_BODY_BYTES) return { body, bodyAttachment: undefined };

  const blob = new Blob([bytes], { type: LONG_TEXT_CONTENT_TYPE });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const bodyAttachment = await uploadMessageAttachment({
      blob, blobUrl, filename: '', mimeType: LONG_TEXT_CONTENT_TYPE, size: blob.size, uniqueId: crypto.randomUUID(),
    }, onProgress);

    let inlineBody = '';
    let size = 0;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(body)) {
      size += encoder.encode(segment).length;
      if (size > MAX_MESSAGE_BODY_BYTES) break;
      inlineBody += segment;
    }
    return { body: inlineBody, bodyAttachment };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Signal quotes a whole message by author and timestamp, with its text and first attachment type */
async function buildQuote(messageId: number): Promise<MessageInitShape<typeof DataMessage_QuoteSchema> | undefined> {
  const target = await db.getMessage(messageId);
  if (!target?.dataMessage) return undefined;

  const quoted = fromBinary(DataMessageSchema, target.dataMessage);
  const attachment = quoted.attachments.find(({ contentType }) => contentType !== LONG_TEXT_CONTENT_TYPE);
  return {
    id: BigInt(target.sentAt),
    authorAci: target.authorAci,
    text: quoted.pollCreate?.question ?? quoted.body,
    bodyRanges: quoted.pollCreate ? [] : quoted.bodyRanges,
    attachments: attachment ? [{ contentType: attachment.contentType, fileName: attachment.fileName }] : [],
    type: quoted.pollCreate ? DataMessage_Quote_Type.POLL : DataMessage_Quote_Type.NORMAL,
  };
}

/** Builds messages of one conversation and sends the users and polls they refer to */
async function buildMessages(records: MessageRecord[], conversation: ConversationRecord) {
  const users = createUserResolver();
  const messages: ApiMessage[] = [];
  const polls: ApiMessagePoll[] = [];
  for (const record of records) {
    const { message, poll } = await buildApiMessageWithPoll(record, conversation, users);
    messages.push(message);
    if (poll) polls.push(poll);
  }

  const apiUsers = await users.buildUsers();
  if (apiUsers.length || polls.length) {
    sendApiUpdate({
      '@type': 'updateEntities',
      users: buildCollectionByKey(apiUsers, 'id'),
      polls: polls.length ? polls : undefined,
    });
  }
  return { messages, users: apiUsers };
}

/** Messages that the app shows, from `fromId` toward older or newer ones */
export async function collectShownMessages(conversationId: string, fromId: number, count: number, isNewer: boolean) {
  const result: MessageRecord[] = [];
  let cursorId = fromId;
  while (result.length < count) {
    const batch = isNewer
      ? await db.getMessagesFrom(conversationId, count, cursorId)
      : await db.getMessages(conversationId, count, cursorId);
    result.push(...batch.filter((message) => !getIsMessageHidden(message)));
    if (batch.length < count) break;
    // `getMessagesFrom` includes its bound and `getMessages` excludes it
    cursorId = isNewer ? batch[batch.length - 1].id + 1 : batch[batch.length - 1].id;
  }
  return result.slice(0, count);
}

async function showLocalMessage(
  chat: ApiChat,
  lastMessageId: number | undefined,
  content: MediaContent,
  options: { replyInfo?: ApiReplyInfo; poll?: ApiMessagePoll; wasDrafted?: boolean },
) {
  const cleanContent = omitUndefined(content);
  if (cleanContent.text) cleanContent.text.emojiOnlyCount = getEmojiOnlyCountForMessage(cleanContent);
  const localMessage: ApiMessage = {
    id: (lastMessageId ?? 0) + ++localMessageCounter / LOCAL_MESSAGES_LIMIT,
    chatId: chat.id,
    content: cleanContent,
    date: getServerTime(),
    isOutgoing: true,
    senderId: await getUserPeerId(getCurrentAccount()!.aci),
    replyInfo: options.replyInfo,
    isForwardingAllowed: true,
  };
  sendApiUpdate({
    '@type': 'newMessage',
    id: localMessage.id,
    chatId: chat.id,
    message: localMessage,
    poll: options.poll,
    wasDrafted: options.wasDrafted,
  });
  return localMessage;
}

function markLocalMessageFailed(localMessage: ApiMessage, err?: unknown) {
  if (err) logError(err);
  sendApiUpdate({
    '@type': 'updateMessageSendFailed',
    chatId: localMessage.chatId,
    localId: localMessage.id,
    error: SEND_ERROR,
  });
}

function sendError(message: string) {
  sendApiUpdate({ '@type': 'error', error: { message, hasErrorKey: true } });
}

async function sendTyping(conversationId: string, isTyping: boolean) {
  await processor.sendTyping(conversationId, isTyping).catch(() => {
    // Typing indicators are best effort
  });
}

async function stopOutgoingTyping(conversationId: string) {
  clearOutgoingTyping(conversationId);
  await sendTyping(conversationId, false);
}

/** A sent message ends typing on the recipients' side, so no stop is sent */
function clearOutgoingTyping(conversationId: string) {
  const typing = outgoingTypingByConversationId.get(conversationId);
  if (!typing) return;
  clearInterval(typing.refreshTimer);
  clearTimeout(typing.pauseTimer);
  outgoingTypingByConversationId.delete(conversationId);
}
