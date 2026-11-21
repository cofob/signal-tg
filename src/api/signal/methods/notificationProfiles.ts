import type { ApiNotificationProfile } from '../../types';

import { buildApiNotificationProfilesState } from '../builders/notificationProfiles';
import { db, processor } from '../engine';
import { getConversationByPeerId } from '../peers';

const MS_PER_SECOND = 1000;

export async function fetchNotificationProfiles() {
  return buildApiNotificationProfilesState(await processor.getNotificationProfiles());
}

/** Creates or changes a profile; a new one has no id */
export async function saveNotificationProfile({ profile }: {
  profile: Omit<ApiNotificationProfile, 'id'> & { id?: string };
}) {
  const { allowedChatIds, ...fields } = profile;
  const conversations = await Promise.all(allowedChatIds.map(getConversationByPeerId));
  const allowedConversationIds = conversations.filter((conversation) => conversation !== undefined).map(({ id }) => id);

  // The profile may allow people whose conversations are not here, which the app does not show; they stay allowed
  const stored = profile.id
    ? (await processor.getNotificationProfiles()).profiles.find(({ id }) => id === profile.id)
    : undefined;
  for (const id of stored?.allowedConversationIds ?? []) {
    if (!await db.getConversation(id)) allowedConversationIds.push(id);
  }

  await processor.saveNotificationProfile({
    ...fields,
    allowedConversationIds,
    scheduleDays: fields.scheduleDays as NonNullable<typeof stored>['scheduleDays'],
  });
  return buildApiNotificationProfilesState(await processor.getNotificationProfiles());
}

export async function deleteNotificationProfile({ id }: { id: string }) {
  await processor.deleteNotificationProfile(id);
  return buildApiNotificationProfilesState(await processor.getNotificationProfiles());
}

/**
 * Turns a profile on by hand, until `endsAt` (seconds) if given; without an id turns profiles off by hand, so that
 * no profile is on until the next schedule starts
 */
export async function setNotificationProfileActive({ id, endsAt }: { id?: string; endsAt?: number }) {
  await processor.setNotificationProfileOverride(id, endsAt && endsAt * MS_PER_SECOND);
  return buildApiNotificationProfilesState(await processor.getNotificationProfiles());
}
