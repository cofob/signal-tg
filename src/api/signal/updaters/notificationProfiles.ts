import type { NotificationProfilesState } from '../../../lib/signal/notificationProfiles/NotificationProfileManager';

import { buildApiNotificationProfilesState } from '../builders/notificationProfiles';
import { sendApiUpdate } from '../updates';

/** Sends the notification profiles after a change, and when the schedule turns a profile on or off */
export async function handleNotificationProfilesChange(state: NotificationProfilesState) {
  sendApiUpdate({ '@type': 'updateNotificationProfiles', state: await buildApiNotificationProfilesState(state) });
}
