import type { MessageInitShape } from '@bufbuild/protobuf';

import type { ConversationRecord, StoryRecord } from '../../../lib/signal/db/MessageDb';
import type { OutgoingStory } from '../../../lib/signal/messages/MessageProcessor';
import type { TextAttachmentSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import type {
  ApiNewStory,
  ApiPeer,
  ApiPeerStories,
  ApiReaction,
  ApiStoryDistributionList,
  ApiStorySettings,
  ApiTextStoryStyle,
  ApiTypeStory,
} from '../../types';

import { TextAttachment_Style } from '../../../lib/signal/proto/generated/SignalService_pb';
import { getAreStoryViewReceiptsEnabled, MY_STORY_ID } from '../../../lib/signal/stories/storyLists';
import { buildCollectionByKey } from '../../../util/iteratees';
import { STORY_BACKGROUNDS } from '../../../util/storyBackgrounds';
import { createUserResolver } from '../builders/messages';
import {
  buildApiStory, buildApiStoryDistributionList, buildStoryViewList, buildStoryViews,
} from '../builders/stories';
import { getCurrentAccount } from '../client';
import { db, logError, processor, store } from '../engine';
import { uploadMessageAttachment } from '../media';
import { getConversationByPeerId, getUserPeerId } from '../peers';
import { sendApiUpdate } from '../updates';
import { buildOutgoingBody } from './messages';

// Stories come from the database, so a full fetch always returns all of them
const STORIES_STATE = 'signal';
const STYLE_BY_NAME: Record<ApiTextStoryStyle, TextAttachment_Style> = {
  default: TextAttachment_Style.DEFAULT,
  regular: TextAttachment_Style.REGULAR,
  bold: TextAttachment_Style.BOLD,
  serif: TextAttachment_Style.SERIF,
  script: TextAttachment_Style.SCRIPT,
  condensed: TextAttachment_Style.CONDENSED,
};

/**
 * Stories that have not expired, by the peer they belong to: the author, the group of a group story, or ourselves.
 * `isHidden` returns the stories of contacts and groups whose stories are hidden (`hideStory`).
 */
export async function fetchAllStories({ isHidden }: {
  isFirstRequest?: boolean;
  stateHash?: string;
  isHidden?: boolean;
}): Promise<{
  peerStories: Record<string, ApiPeerStories>; hasMore?: true; state: string;
} | undefined> {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci) return undefined;

  const conversations = new Map((await db.getConversations()).map((conversation) => [conversation.id, conversation]));
  const users = createUserResolver();
  const peerStories: Record<string, ApiPeerStories> = {};
  for (const story of await processor.getStories()) {
    const conversation = conversations.get(story.conversationId);
    if (!conversation || Boolean(conversation.isStoryHidden) !== Boolean(isHidden)) continue;
    const apiStory = await buildApiStory(story, conversation, selfAci, users);
    const peer = peerStories[apiStory.peerId] ??= { byId: {}, orderedIds: [], profileIds: [] };
    peer.byId[story.id] = apiStory;
    peer.orderedIds.push(story.id);
    peer.lastUpdatedAt = Math.max(peer.lastUpdatedAt ?? 0, apiStory.date);
    // Stories are read up to the first one not viewed, so the viewer starts there
    if (!story.viewedAt && peer.lastReadId === undefined) peer.lastReadId = story.id - 1;
  }
  for (const peer of Object.values(peerStories)) peer.lastReadId ??= peer.orderedIds[peer.orderedIds.length - 1];

  await sendUsers(users);
  return { peerStories, state: STORIES_STATE };
}

export async function fetchPeerStories({ peer }: { peer: ApiPeer }) {
  const found = await getPeerStories(peer);
  if (!found) return undefined;
  const { conversation, stories } = found;
  const unviewed = stories.find(({ viewedAt }) => !viewedAt);
  return {
    stories: await buildStories(stories, conversation),
    lastReadStoryId: unviewed ? unviewed.id - 1 : stories[stories.length - 1]?.id,
  };
}

/** Stories of a peer by id; expired and deleted stories are left out */
export async function fetchPeerStoriesByIds({ peer, ids }: { peer: ApiPeer; ids: number[] }) {
  const found = await getPeerStories(peer);
  if (!found) return undefined;
  const stories = found.stories.filter(({ id }) => ids.includes(id));
  return { stories: await buildStories(stories, found.conversation), pinnedIds: undefined };
}

/** Signal stories are viewed once; viewing sends a viewed receipt when story view receipts are on */
export async function markStoryRead({ storyId }: { peer: ApiPeer; storyId: number }) {
  await processor.markStoryViewed(storyId).catch(logError);
  return true;
}

export async function deleteStory({ storyId }: { peer: ApiPeer; storyId: number }) {
  try {
    await processor.deleteStoryForEveryone(storyId);
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

export async function fetchStoriesViews({ storyIds }: { peer: ApiPeer; storyIds: number[] }) {
  const story = await db.getStory(storyIds[0]);
  if (!story?.isOutgoing) return undefined;
  const users = createUserResolver();
  const views = await buildStoryViews(story, users);
  await sendUsers(users);
  return { views };
}

/** Everyone who viewed our story, and the replies it got; they come in one page */
export async function fetchStoryViewList({ storyId }: {
  peer: ApiPeer;
  storyId: number;
  areJustContacts?: true;
  areReactionsFirst?: true;
  limit?: number;
  offset?: string;
  query?: string;
}) {
  const story = await db.getStory(storyId);
  if (!story?.isOutgoing) return undefined;
  const users = createUserResolver();
  const views = await buildStoryViewList(story, users);
  await sendUsers(users);
  return { views, nextOffset: undefined };
}

/** Signal reactions to stories are sent like messages and cannot be taken back, so removing one changes nothing */
export async function sendStoryReaction({ storyId, reaction }: {
  peer: ApiPeer;
  storyId: number;
  reaction?: ApiReaction;
  shouldAddToRecent?: boolean;
}) {
  if (reaction?.type !== 'emoji') return true;
  try {
    await processor.sendStoryReply(storyId, { emoji: reaction.emoticon });
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/** Hides the stories of a contact or group (`hideStory` in storage) */
export async function toggleStoriesHidden({ peer, isHidden }: { peer: ApiPeer; isHidden: boolean }) {
  const conversation = await getConversationByPeerId(peer.id);
  if (!conversation) return undefined;
  await processor.setStoryHidden(conversation.id, isHidden);
  return true;
}

/**
 * Sends a new story to distribution lists and groups. A text story uses one of Signal's preset backgrounds; a media
 * story uploads its photo or video with the caption.
 */
export async function sendStory({ story, listIds, groupIds }: {
  story: ApiNewStory;
  listIds: string[];
  groupIds: string[];
}) {
  try {
    const groups = await Promise.all(groupIds.map(getConversationByPeerId));
    await processor.sendStory(await buildOutgoingStory(story), {
      listIds,
      groupIds: groups.filter((group): group is ConversationRecord => group?.type === 'group').map(({ id }) => id),
    });
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

export async function fetchStoryDistributionLists(): Promise<ApiStoryDistributionList[]> {
  const lists = await processor.getStoryDistributionLists();
  const users = createUserResolver();
  const result = await Promise.all(lists.map((list) => buildApiStoryDistributionList(list, users.getUserId)));
  await sendUsers(users);
  return result;
}

/** Creates or changes a distribution list; a new one gets a random id */
export async function saveStoryDistributionList({ list }: {
  list: Omit<ApiStoryDistributionList, 'id'> & { id?: string };
}) {
  const memberAcis = (await Promise.all(list.memberIds.map(getConversationByPeerId)))
    .filter((conversation): conversation is ConversationRecord => conversation?.type === 'private')
    .map(({ id }) => id);
  const saved = await processor.saveStoryDistributionList({
    id: list.id ?? crypto.randomUUID(),
    name: list.name,
    memberAcis,
    areRepliesAllowed: list.areRepliesAllowed,
    isBlockList: list.id === MY_STORY_ID && list.isBlockList,
  });
  return buildApiStoryDistributionList(saved, getUserPeerId);
}

export async function deleteStoryDistributionList({ id }: { id: string }) {
  await processor.deleteStoryDistributionList(id);
  return true;
}

export async function fetchStorySettings(): Promise<ApiStorySettings | undefined> {
  const account = await store.getItem('account');
  if (!account) return undefined;
  return {
    areStoriesDisabled: account.isStoriesDisabled,
    areViewReceiptsEnabled: getAreStoryViewReceiptsEnabled(account),
  };
}

export async function updateStorySettings({ areStoriesDisabled, areViewReceiptsEnabled }: Partial<ApiStorySettings>) {
  const account = await processor.updateStorySettings({
    isStoriesDisabled: areStoriesDisabled,
    isStoryViewReceiptsEnabled: areViewReceiptsEnabled,
  });
  return {
    areStoriesDisabled: account.isStoriesDisabled,
    areViewReceiptsEnabled: getAreStoryViewReceiptsEnabled(account),
  } satisfies ApiStorySettings;
}

async function buildOutgoingStory({
  text, textStyle = 'default', backgroundIndex = 0, attachment, caption,
}: ApiNewStory): Promise<OutgoingStory> {
  if (attachment) {
    const { body, bodyRanges } = caption?.text ? await buildOutgoingBody(caption) : { body: '', bodyRanges: [] };
    const pointer = await uploadMessageAttachment(attachment);
    return { attachment: { case: 'fileAttachment', value: { ...pointer, caption: body } }, bodyRanges };
  }
  if (!text?.text) throw new Error('A story needs text or media');

  const background = STORY_BACKGROUNDS[backgroundIndex] ?? STORY_BACKGROUNDS[0];
  const textAttachment: MessageInitShape<typeof TextAttachmentSchema> = {
    text: text.text,
    textStyle: STYLE_BY_NAME[textStyle],
    background: 'color' in background
      ? { case: 'color', value: background.color }
      : { case: 'gradient', value: background },
  };
  return { attachment: { case: 'textAttachment', value: textAttachment } };
}

async function getPeerStories(peer: ApiPeer) {
  const conversation = await getConversationByPeerId(peer.id);
  if (!conversation) return undefined;
  const stories = (await processor.getStories()).filter(({ conversationId }) => conversationId === conversation.id);
  return { conversation, stories };
}

async function buildStories(stories: StoryRecord[], conversation: ConversationRecord) {
  const selfAci = getCurrentAccount()!.aci;
  const users = createUserResolver();
  const result: Record<number, ApiTypeStory> = {};
  for (const story of stories) result[story.id] = await buildApiStory(story, conversation, selfAci, users);
  await sendUsers(users);
  return result;
}

/** Story authors and viewers may be users the app has not seen yet */
async function sendUsers(users: ReturnType<typeof createUserResolver>) {
  const apiUsers = await users.buildUsers();
  if (apiUsers.length) sendApiUpdate({ '@type': 'updateEntities', users: buildCollectionByKey(apiUsers, 'id') });
}
