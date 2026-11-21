import type { NotificationProfilesState } from '../../../lib/signal/notificationProfiles/NotificationProfileManager';
import type { NotificationProfile } from '../../../lib/signal/notificationProfiles/notificationProfiles';
import type { ApiNotificationProfile, ApiNotificationProfilesState } from '../../types';

import { db } from '../engine';
import { getPeerId } from '../peers';

const MS_PER_SECOND = 1000;

/** The state of the app; the profiles name chats by the app's peer ids, and chats that are gone are left out */
export async function buildApiNotificationProfilesState(
  state: NotificationProfilesState,
): Promise<ApiNotificationProfilesState> {
  const { override } = state;
  return {
    profiles: await Promise.all(state.profiles.map(buildApiNotificationProfile)),
    activeProfileId: state.activeProfileId,
    nextChangeAt: state.nextChangeAt && Math.floor(state.nextChangeAt / MS_PER_SECOND),
    isManuallyEnabled: override?.enabled ? true : undefined,
    isManuallyDisabled: override?.disabledAt ? true : undefined,
    overrideEndsAt: override?.enabled?.endsAt && Math.floor(override.enabled.endsAt / MS_PER_SECOND),
    isSyncDisabled: state.isSyncDisabled,
  };
}

async function buildApiNotificationProfile(profile: NotificationProfile): Promise<ApiNotificationProfile> {
  const allowedChatIds: string[] = [];
  for (const id of profile.allowedConversationIds) {
    const conversation = await db.getConversation(id);
    if (conversation) allowedChatIds.push(getPeerId(conversation));
  }
  return {
    id: profile.id,
    name: profile.name,
    emoji: profile.emoji,
    color: profile.color,
    allowedChatIds,
    areAllCallsAllowed: profile.areAllCallsAllowed,
    areAllMentionsAllowed: profile.areAllMentionsAllowed,
    isScheduleEnabled: profile.isScheduleEnabled,
    scheduleStartTime: profile.scheduleStartTime,
    scheduleEndTime: profile.scheduleEndTime,
    scheduleDays: profile.scheduleDays,
  };
}
