import { fromBinary } from '@bufbuild/protobuf';

import type { ConversationRecord, MessageRecord } from '../../../lib/signal/db/MessageDb';
import type {
  BodyRange, DataMessage_PollCreate, DataMessage_Quote,
} from '../../../lib/signal/proto/generated/SignalService_pb';
import type {
  ApiMessage,
  ApiMessagePoll,
  ApiPeerReaction,
  ApiPollResult,
  ApiReactionCount,
  ApiReactions,
  ApiReplyInfo,
  ApiUser,
  MediaContent,
} from '../../types';
import type { MentionedUser } from './bodyRanges';

import { DataMessageSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import { uuidToString } from '../../../lib/signal/serviceId';
import { getEmojiOnlyCountForMessage } from '../../../global/helpers/getEmojiOnlyCountForMessage';
import { omitUndefined } from '../../../util/iteratees';
import { getCurrentAccount } from '../client';
import { db, processor } from '../engine';
import { getPeerId } from '../peers';
import { buildApiFormattedText, getMentionAci } from './bodyRanges';
import { buildMessageMedia } from './media';
import { buildApiUser } from './users';

type UserResolver = ReturnType<typeof createUserResolver>;

const MS_PER_SECOND = 1000;

/** Builds the app message of a stored Signal message; `conversation` is the one it belongs to */
export async function buildApiMessage(message: MessageRecord, conversation: ConversationRecord): Promise<ApiMessage> {
  return (await buildApiMessageWithPoll(message, conversation, createUserResolver())).message;
}

/**
 * Builds the app message and, for polls, its poll. `users` resolves the people the message refers to
 * (sender, mentions, reactions, votes), so callers can send those users along.
 */
export async function buildApiMessageWithPoll(
  message: MessageRecord, conversation: ConversationRecord, users: UserResolver,
): Promise<{ message: ApiMessage; poll?: ApiMessagePoll }> {
  const selfAci = getCurrentAccount()?.aci;
  const senderAci = message.authorAci || message.actorAci;
  const base = {
    id: message.id,
    chatId: getPeerId(conversation),
    date: convertToSeconds(message.sentAt),
    isOutgoing: message.isOutgoing,
    senderId: senderAci ? await users.getUserId(senderAci) : undefined,
  } satisfies Partial<ApiMessage>;

  if (message.kind === 'timerUpdate') {
    return {
      message: {
        ...base,
        content: { action: { mediaType: 'action', type: 'setMessagesTtl', period: message.expireTimer ?? 0 } },
      },
    };
  }
  if (message.kind !== 'message') {
    return { message: { ...base, content: { action: { mediaType: 'action', type: 'unsupported' } } } };
  }
  // Hidden from the history, see `getIsMessageHidden`
  if (!message.dataMessage) return { message: { ...base, content: {} } };

  const dataMessage = fromBinary(DataMessageSchema, message.dataMessage);
  const media = buildMessageMedia(message, dataMessage);
  const mentionedUsers = await resolveMentionedUsers(dataMessage.bodyRanges, users);
  const poll = dataMessage.pollCreate
    ? await buildApiPoll(message, dataMessage.pollCreate, selfAci, users)
    : undefined;
  const { body, bodyRanges } = dataMessage;
  const content: MediaContent = omitUndefined({
    ...media,
    text: body ? buildApiFormattedText(body, bodyRanges, mentionedUsers) : undefined,
    pollId: poll?.summary.id,
  });
  if (content.text) content.text.emojiOnlyCount = getEmojiOnlyCountForMessage(content);
  // View-once media (the app has no flow for it yet), gift badges, payments and other content without
  // a counterpart in the app
  if (!Object.keys(content).length) content.action = { mediaType: 'action', type: 'unsupported' };

  const isMentioned = Boolean(selfAci) && dataMessage.bodyRanges.some((range) => getMentionAci(range) === selfAci);
  const hasViewableMedia = Boolean(content.voice || content.video?.isRound);
  return {
    message: {
      ...base,
      content,
      replyInfo: dataMessage.quote ? await buildReplyInfo(dataMessage.quote, message, users) : undefined,
      isEdited: message.editedAt ? true : undefined,
      editDate: message.editedAt ? convertToSeconds(message.editedAt) : undefined,
      reactions: await buildApiReactions(message, selfAci, users),
      sendingState: getSendingState(message),
      ttlPeriod: message.expiresAt ? Math.round(message.expiresAt / MS_PER_SECOND) - base.date : undefined,
      isMentioned: isMentioned || undefined,
      hasUnreadMention: isMentioned && !message.readAt ? true : undefined,
      isMediaUnread: !message.isOutgoing && !message.viewedAt && hasViewableMedia ? true : undefined,
      isForwardingAllowed: !dataMessage.isViewOnce,
      isProtected: dataMessage.isViewOnce || undefined,
    },
    poll,
  };
}

/**
 * Remote deletes and opened view-once messages leave records without content. The app removes them, as it
 * does with messages deleted for everyone.
 */
export function getIsMessageHidden(message: MessageRecord) {
  return message.kind === 'message' && !message.dataMessage;
}

/** Resolves users by ACI once for messages built together; users seen only in groups get a private conversation */
export function createUserResolver() {
  const selfAci = getCurrentAccount()?.aci ?? '';
  const conversations = new Map<string, Promise<ConversationRecord>>();

  function getConversation(aci: string) {
    let conversation = conversations.get(aci);
    if (!conversation) {
      conversation = processor.getOrCreatePrivateConversation(aci);
      conversations.set(aci, conversation);
    }
    return conversation;
  }

  return {
    async getUserId(aci: string) {
      return getPeerId(await getConversation(aci));
    },
    async getUser(aci: string) {
      return buildApiUser(await getConversation(aci), selfAci);
    },
    /** Every user resolved so far */
    async buildUsers(): Promise<ApiUser[]> {
      return Promise.all([...conversations.values()].map(async (conversation) => (
        buildApiUser(await conversation, selfAci)
      )));
    },
  };
}

async function resolveMentionedUsers(bodyRanges: BodyRange[], users: UserResolver) {
  const mentionedUsers = new Map<string, MentionedUser>();
  for (const range of bodyRanges) {
    const aci = getMentionAci(range);
    if (!aci || mentionedUsers.has(aci)) continue;
    const { id, firstName, lastName } = await users.getUser(aci);
    mentionedUsers.set(aci, { userId: id, name: [firstName, lastName].filter(Boolean).join(' ') });
  }
  return mentionedUsers;
}

/**
 * A quote names its message by author and timestamp. A message found in the same conversation becomes
 * a regular reply; otherwise the reply shows the author and the text the quote carries, unless the quoted
 * message was deleted.
 */
async function buildReplyInfo(
  quote: DataMessage_Quote, message: MessageRecord, users: UserResolver,
): Promise<ApiReplyInfo> {
  const authorAci = quote.authorAci || (quote.authorAciBinary.length ? uuidToString(quote.authorAciBinary) : '');
  const sentAt = Number(quote.id);
  const target = authorAci ? await db.findMessage(authorAci, sentAt) : undefined;
  if (target && target.conversationId === message.conversationId && !getIsMessageHidden(target)) {
    return { type: 'message', replyToMsgId: target.id };
  }

  const hasText = Boolean(quote.text) && !(target && getIsMessageHidden(target));
  return {
    type: 'message',
    replyFrom: authorAci ? {
      date: convertToSeconds(sentAt),
      isChannelPost: false,
      fromId: await users.getUserId(authorAci),
    } : undefined,
    quoteText: hasText
      ? buildApiFormattedText(quote.text, quote.bodyRanges, await resolveMentionedUsers(quote.bodyRanges, users))
      : undefined,
    isQuote: hasText || undefined,
  };
}

async function buildApiReactions(
  message: MessageRecord, selfAci: string | undefined, users: UserResolver,
): Promise<ApiReactions | undefined> {
  if (!message.reactions?.length) return undefined;

  const results: ApiReactionCount[] = [];
  const recentReactions: ApiPeerReaction[] = [];
  for (const { emoji, authorAci, sentAt } of message.reactions) {
    const reaction = { type: 'emoji', emoticon: emoji } as const;
    const isOwn = authorAci === selfAci;
    let result = results.find((current) => current.reaction.type === 'emoji' && current.reaction.emoticon === emoji);
    if (!result) {
      result = { reaction, count: 0 };
      results.push(result);
    }
    result.count++;
    if (isOwn) result.chosenOrder = 0;
    recentReactions.push({
      peerId: await users.getUserId(authorAci),
      reaction,
      addedDate: convertToSeconds(sentAt),
      isOwn: isOwn || undefined,
    });
  }

  return {
    canSeeList: true,
    results: results.sort((a, b) => b.count - a.count),
    recentReactions: recentReactions.sort((a, b) => b.addedDate - a.addedDate),
  };
}

/** Signal polls show who voted; options are identified by their index */
async function buildApiPoll(
  message: MessageRecord, pollCreate: DataMessage_PollCreate, selfAci: string | undefined, users: UserResolver,
): Promise<ApiMessagePoll> {
  const votes = (message.pollVotes ?? []).filter(({ optionIndexes }) => optionIndexes.length);
  const resultByOption: Record<string, ApiPollResult> = {};
  for (const index of pollCreate.options.keys()) {
    const option = String(index);
    const voters = votes.filter(({ optionIndexes }) => optionIndexes.includes(index));
    resultByOption[option] = {
      option,
      votersCount: voters.length,
      isChosen: voters.some(({ authorAci }) => authorAci === selfAci) || undefined,
      recentVoterIds: await Promise.all(voters.map(({ authorAci }) => users.getUserId(authorAci))),
    };
  }

  return {
    mediaType: 'poll',
    summary: {
      id: String(message.id),
      hash: '',
      isClosed: message.isPollEnded || undefined,
      isPublic: true,
      isMultipleChoice: pollCreate.allowMultiple || undefined,
      isCreator: message.isOutgoing || undefined,
      question: { text: pollCreate.question },
      answers: pollCreate.options.map((text, index) => ({ text: { text }, option: String(index) })),
    },
    results: {
      resultByOption,
      totalVoters: votes.length,
      recentVoterIds: await Promise.all(votes.map(({ authorAci }) => users.getUserId(authorAci))),
    },
  };
}

/** Pending while any recipient waits, failed when any recipient failed, as Signal Desktop shows it */
function getSendingState({ isOutgoing, recipientStatus }: MessageRecord): ApiMessage['sendingState'] {
  if (!isOutgoing || !recipientStatus) return undefined;
  const statuses = Object.values(recipientStatus);
  if (statuses.includes('pending')) return 'messageSendingStatePending';
  if (statuses.includes('failed')) return 'messageSendingStateFailed';
  return undefined;
}

function convertToSeconds(timestamp: number) {
  return Math.floor(timestamp / MS_PER_SECOND);
}
