import type { MessageChanges } from '../../../lib/signal/messages/MessageProcessor';
import type { ApiUpdate } from '../../types';

import { buildCollectionByKey } from '../../../util/iteratees';
import { createUserResolver } from '../builders/messages';
import { buildApiStory } from '../builders/stories';
import { getCurrentAccount } from '../client';
import { db, processor } from '../engine';
import { getPeerId } from '../peers';
import { sendApiUpdate } from '../updates';

/**
 * Sends new and changed stories, deleted and expired ones, and how far the stories of each changed peer are read:
 * up to the first story not viewed
 */
export async function handleStoryChanges({ stories, deletedStories }: MessageChanges) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci || (!stories.length && !deletedStories.length)) return;

  const users = createUserResolver();
  const updates: ApiUpdate[] = [];
  const changedConversationIds = new Set<string>();
  for (const story of stories) {
    const conversation = await db.getConversation(story.conversationId);
    if (!conversation) continue;
    const apiStory = await buildApiStory(story, conversation, selfAci, users);
    updates.push({ '@type': 'updateStory', peerId: apiStory.peerId, story: apiStory });
    changedConversationIds.add(conversation.id);
  }
  for (const story of deletedStories) {
    const conversation = await db.getConversation(story.conversationId);
    if (conversation) updates.push({ '@type': 'deleteStory', peerId: getPeerId(conversation), storyId: story.id });
  }

  const active = await processor.getStories();
  for (const conversationId of changedConversationIds) {
    const own = active.filter((story) => story.conversationId === conversationId);
    if (!own.length) continue;
    const unviewed = own.find(({ viewedAt }) => !viewedAt);
    const conversation = (await db.getConversation(conversationId))!;
    updates.push({
      '@type': 'updateReadStories',
      peerId: getPeerId(conversation),
      lastReadId: unviewed ? unviewed.id - 1 : own[own.length - 1].id,
    });
  }

  const apiUsers = await users.buildUsers();
  if (apiUsers.length) sendApiUpdate({ '@type': 'updateEntities', users: buildCollectionByKey(apiUsers, 'id') });
  updates.forEach(sendApiUpdate);
}
