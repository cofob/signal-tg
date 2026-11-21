import type { ApiMessage } from '../../api/types';
import type { GlobalState } from '../types';

import { getMessageReplyInfo } from '../helpers/replies';
import { selectChatMessage } from './messages';

/** The notification profile that is on, if any */
export function selectActiveNotificationProfile<T extends GlobalState>(global: T) {
  const { profiles, activeProfileId } = global.notificationProfiles || {};
  return activeProfileId ? profiles?.find(({ id }) => id === activeProfileId) : undefined;
}

/**
 * Whether the notification profile that is on silences the message (Signal Desktop `shouldNotify` in
 * `ts/types/NotificationProfile.std.ts`): only the chats of the profile notify, and mentions of us and replies to our
 * messages when the profile allows them all
 */
export function selectIsMessageSilencedByNotificationProfile<T extends GlobalState>(
  global: T, chatId: string, message: Partial<ApiMessage>,
) {
  const profile = selectActiveNotificationProfile(global);
  if (!profile || profile.allowedChatIds.includes(chatId)) return false;
  if (!profile.areAllMentionsAllowed) return true;

  const replyToMsgId = message.replyInfo && getMessageReplyInfo(message as ApiMessage)?.replyToMsgId;
  const isReplyToOwnMessage = Boolean(replyToMsgId && selectChatMessage(global, chatId, replyToMsgId)?.isOutgoing);
  return !(message.isMentioned || isReplyToOwnMessage);
}
