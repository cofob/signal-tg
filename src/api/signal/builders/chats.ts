import type { ConversationRecord, MessageRecord } from '../../../lib/signal/db/MessageDb';
import type { ThreadReadState } from '../../../types';
import type {
  ApiChat,
  ApiChatAdminRights,
  ApiChatBannedRights,
  ApiChatFullInfo,
  ApiChatMember,
  ApiPeerNotifySettings,
  ApiThreadInfo,
  ApiUser,
} from '../../types';
import { MAIN_THREAD_ID } from '../../types';

import { ARCHIVED_FOLDER_ID, MUTE_INDEFINITE_TIMESTAMP } from '../../../config';
import { buildCollectionByKey } from '../../../util/iteratees';
import { getServerTime } from '../../../util/serverTime';
import { db, processor } from '../engine';
import { getPeerId } from '../peers';
import { buildApiUser, buildAvatarColor, getAvatarPhotoId } from './users';

const READ_STATE_PAGE_SIZE = 50;
// Signal group admins edit the group, add and remove members and admins, pin messages and delete them for everyone
const GROUP_ADMIN_RIGHTS: ApiChatAdminRights = {
  changeInfo: true,
  deleteMessages: true,
  banUsers: true,
  inviteUsers: true,
  pinMessages: true,
  addAdmins: true,
};
const ANNOUNCEMENTS_ONLY_RIGHTS: ApiChatBannedRights = { sendMessages: true };

/**
 * Builds the chat of a conversation. Private conversations are chats with the user's id; groups are basic
 * groups. A group we are no longer a member of keeps its history but cannot be written to, as in Signal.
 */
export function buildApiChat(conversation: ConversationRecord, selfAci: string): ApiChat {
  const id = getPeerId(conversation);
  const folderId = conversation.isArchived ? ARCHIVED_FOLDER_ID : undefined;
  const avatarPhotoId = getAvatarPhotoId(conversation);
  const color = buildAvatarColor(conversation);
  const isListed = getIsChatListed(conversation, selfAci);

  if (conversation.type === 'private') {
    const { firstName, lastName, usernames, hasUsername } = buildApiUser(conversation, selfAci);
    return {
      id,
      type: 'chatTypePrivate',
      title: [firstName, lastName].filter(Boolean).join(' '),
      folderId,
      avatarPhotoId,
      color,
      usernames,
      hasUsername,
      ttlPeriod: conversation.expireTimer,
      isListed,
    };
  }

  const { memberAcis, adminAcis } = conversation;
  return {
    id,
    type: 'chatTypeBasicGroup',
    title: conversation.title ?? '',
    folderId,
    avatarPhotoId,
    color,
    membersCount: memberAcis?.length,
    ttlPeriod: conversation.expireTimer,
    isListed,
    isForbidden: memberAcis && !memberAcis.includes(selfAci) ? true : undefined,
    adminRights: adminAcis?.includes(selfAci) ? GROUP_ADMIN_RIGHTS : undefined,
    defaultBannedRights: conversation.isAnnouncementsOnly ? ANNOUNCEMENTS_ONLY_RIGHTS : undefined,
  };
}

/**
 * Whether a conversation is in the chat list. Signal Desktop lists conversations with `active_at`, which
 * messages and joining a group set and blocking keeps, so a blocked conversation stays only while it has
 * messages (`ts/state/selectors/conversations.dom.ts`, `_getLeftPaneLists`). Pinned conversations always show.
 */
export function getIsChatListed(conversation: ConversationRecord, selfAci: string) {
  if (conversation.lastMessageId !== undefined || conversation.pinIndex !== undefined) return true;
  return conversation.type === 'group' && !conversation.isBlocked
    && Boolean(conversation.memberAcis?.includes(selfAci));
}

/** Pinned conversations in pin order */
export function getPinnedConversations(conversations: ConversationRecord[]) {
  return conversations
    .filter(({ pinIndex }) => pinIndex !== undefined)
    .sort((a, b) => a.pinIndex! - b.pinIndex!);
}

/** The mute state in seconds; Signal stores milliseconds and mutes forever with a time far in the future */
export function buildNotifySettings(conversation: ConversationRecord): ApiPeerNotifySettings {
  const { mutedUntil } = conversation;
  const isMuted = mutedUntil !== undefined && mutedUntil > getServerTime() * 1000;
  return {
    mutedUntil: isMuted ? Math.min(Math.floor(mutedUntil / 1000), MUTE_INDEFINITE_TIMESTAMP) : undefined,
  };
}

export function buildThreadInfo(chatId: string, lastMessageId?: number): ApiThreadInfo {
  return {
    isCommentsInfo: false,
    chatId,
    threadId: MAIN_THREAD_ID,
    lastMessageId,
  };
}

/**
 * The read state of a chat. The last read incoming message is the one before the oldest unread message,
 * and the last read outgoing message is the newest one a recipient read among the scanned pages.
 * Reading marks every earlier message read, so unread messages are the newest ones and a few pages suffice.
 */
export async function buildThreadReadState(conversation: ConversationRecord): Promise<ThreadReadState> {
  let unreadLeft = conversation.unreadCount;
  let lastReadInboxMessageId: number | undefined;
  let lastReadOutboxMessageId: number | undefined;
  let beforeId: number | undefined;
  let isDone = false;

  while (!isDone) {
    const page = await db.getMessages(conversation.id, READ_STATE_PAGE_SIZE, beforeId);
    for (const message of page) {
      if (lastReadOutboxMessageId === undefined && getIsReadByRecipient(message)) {
        lastReadOutboxMessageId = message.id;
      }
      if (lastReadInboxMessageId !== undefined) continue;
      if (!unreadLeft) {
        lastReadInboxMessageId = message.id;
      } else if (getIsUnreadIncoming(message)) {
        unreadLeft--;
      }
    }
    beforeId = page[page.length - 1]?.id;
    isDone = page.length < READ_STATE_PAGE_SIZE || lastReadInboxMessageId !== undefined;
  }

  return {
    unreadCount: conversation.unreadCount,
    hasUnreadMark: Boolean(conversation.isMarkedUnread),
    lastReadInboxMessageId,
    lastReadOutboxMessageId,
  };
}

/** Signal shows an outgoing message as read once any recipient read it */
export function getIsReadByRecipient(message: MessageRecord) {
  return message.isOutgoing && Object.values(message.recipientStatus ?? {})
    .some((status) => status === 'read' || status === 'viewed');
}

/** Group details with members; members seen for the first time get user records */
export async function buildGroupFullInfo(
  conversation: ConversationRecord, selfAci: string,
): Promise<{ fullInfo: ApiChatFullInfo; users: ApiUser[] }> {
  const memberConversations: ConversationRecord[] = [];
  for (const aci of conversation.memberAcis ?? []) {
    memberConversations.push(await processor.getOrCreatePrivateConversation(aci));
  }

  const adminAcis = new Set(conversation.adminAcis);
  const members = memberConversations.map((member): ApiChatMember => {
    const isAdmin = adminAcis.has(member.id);
    return {
      userId: getPeerId(member),
      isAdmin: isAdmin ? true : undefined,
      adminRights: isAdmin ? GROUP_ADMIN_RIGHTS : undefined,
    };
  });

  return {
    fullInfo: {
      about: conversation.description,
      ttlPeriod: conversation.expireTimer,
      members,
      adminMembersById: buildCollectionByKey(members.filter(({ isAdmin }) => isAdmin), 'userId'),
      canViewMembers: true,
      // New members of Signal groups do not see earlier messages
      isPreHistoryHidden: true,
    },
    users: memberConversations.map((member) => buildApiUser(member, selfAci)),
  };
}

// Mirrors `MessageDb.getUnreadMessages`
function getIsUnreadIncoming(message: MessageRecord) {
  return !message.isOutgoing && !message.readAt && message.kind === 'message';
}
