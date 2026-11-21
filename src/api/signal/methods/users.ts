import type { ConversationRecord } from '../../../lib/signal/db/MessageDb';
import type { ApiPeer, ApiUser } from '../../types';

import { SyncMessage_MessageRequestResponse_Type } from '../../../lib/signal/proto/generated/SignalService_pb';
import { buildCollectionByKey } from '../../../util/iteratees';
import { buildApiChat } from '../builders/chats';
import {
  buildApiUser, buildApiUserFullInfo, buildAvatarPhoto, getIsContact,
} from '../builders/users';
import { getCurrentAccount } from '../client';
import { db, logError, processor } from '../engine';
import { getConversationByPeerId, getPeerId } from '../peers';
import { sendApiUpdate } from '../updates';

const ACI_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The chat with an ACI, such as a shared contact's, created when there is none yet */
export async function getChatByAci(aci: string) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci || !ACI_REGEX.test(aci)) return undefined;
  const conversation = await processor.getOrCreatePrivateConversation(aci);
  return { chat: buildApiChat(conversation, selfAci), user: buildApiUser(conversation, selfAci) };
}

export async function fetchFullUser({ id }: { id: string; accessHash?: string }) {
  const selfAci = getCurrentAccount()?.aci;
  const conversation = await getConversationByPeerId(id);
  if (!selfAci || !conversation) return undefined;

  const user = buildApiUser(conversation, selfAci);
  const commonGroups = getCommonGroups(await db.getConversations(), conversation.id, selfAci);
  const fullInfo = { ...buildApiUserFullInfo(conversation, selfAci), commonChatsCount: commonGroups.length };
  sendApiUpdate({
    '@type': 'updateUser', id, user, fullInfo,
  });

  return {
    user,
    fullInfo,
    users: [user],
    chats: [],
    userStatusesById: {},
  };
}

export async function fetchUsers({ users }: { users: ApiUser[] }) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return undefined;

  const conversations = await Promise.all(users.map(({ id }) => getConversationByPeerId(id)));
  return {
    users: conversations.filter(Boolean).map((conversation) => buildApiUser(conversation, selfAci)),
    userStatusesById: {},
  };
}

export async function fetchContactList() {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return undefined;

  const contacts = (await db.getConversations()).filter((conversation) => getIsContact(conversation, selfAci));
  return {
    users: contacts.map((conversation) => buildApiUser(conversation, selfAci)),
    userStatusesById: {},
  };
}

/** Groups we share with the user; all of them come in one page */
export async function fetchCommonChats({ user }: { user: ApiUser; maxId?: string }) {
  const selfAci = getCurrentAccount()?.aci;
  const conversation = await getConversationByPeerId(user.id);
  if (!selfAci || !conversation) return undefined;

  const groups = getCommonGroups(await db.getConversations(), conversation.id, selfAci);
  const chats = groups.map((group) => buildApiChat(group, selfAci));
  sendApiUpdate({ '@type': 'updateEntities', chats: buildCollectionByKey(chats, 'id') });
  return { chatIds: groups.map(getPeerId), count: groups.length };
}

/**
 * Reports the chat as spam to our other devices and, for a contact, its latest messages to the server
 * (Signal Desktop `reportSpam` in `ts/state/ducks/conversations.preload.ts`)
 */
export async function reportSpam(peer: ApiPeer) {
  const conversation = await getConversationByPeerId(peer.id);
  if (!conversation) return undefined;

  try {
    await processor.respondToMessageRequest(conversation.id, SyncMessage_MessageRequestResponse_Type.SPAM);
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

function getCommonGroups(conversations: ConversationRecord[], aci: string, selfAci: string) {
  return conversations.filter(({ type, memberAcis }) => (
    type === 'group' && memberAcis?.includes(aci) && memberAcis.includes(selfAci)
  ));
}

/** Signal keeps one avatar per user or group, so the profile photo list holds at most the current avatar */
export async function fetchProfilePhotos({ peer }: { peer: ApiPeer; offset?: number; limit?: number }) {
  const conversation = await getConversationByPeerId(peer.id);
  const photo = conversation && buildAvatarPhoto(conversation);
  const photos = photo ? [photo] : [];
  return { photos, count: photos.length, nextOffsetId: undefined };
}
