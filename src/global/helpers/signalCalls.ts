import type { ApiCallLogOutcome, ApiCallLogType } from '../../api/types';
import type { RegularLangKey } from '../../types/language';

// Signal Desktop `getCallingNotificationText` in `ts/util/callingNotification.std.ts`: a group call that started
// shows as started for this long, then like an ended one, because the peek of the call that Desktop asks the group
// call server for is not available here
const GROUP_CALL_STARTED_MS = 5 * 60 * 1000;

const KEYS = {
  incoming: { audio: 'ActionCallIncomingAudio', video: 'ActionCallIncomingVideo' },
  outgoing: { audio: 'ActionCallOutgoingAudio', video: 'ActionCallOutgoingVideo' },
  declined: { audio: 'ActionCallDeclinedAudio', video: 'ActionCallDeclinedVideo' },
  missed: { audio: 'ActionCallMissedAudio', video: 'ActionCallMissedVideo' },
  unanswered: { audio: 'ActionCallUnansweredAudio', video: 'ActionCallUnansweredVideo' },
} as const satisfies Record<string, Record<'audio' | 'video', RegularLangKey>>;

/**
 * The text of a call in a chat, as Signal Desktop words it (`getDirectCallNotificationText`): a call that was not
 * answered and an outgoing call that nobody answered read differently. Group calls are video calls.
 */
export function getSignalCallLangKey(
  callType: ApiCallLogType, outcome: ApiCallLogOutcome, isOutgoing: boolean, startedAgoMs?: number,
): RegularLangKey {
  const kind = callType === 'audio' ? 'audio' : 'video';

  if (callType === 'group' && outcome === 'pending' && startedAgoMs !== undefined
    && startedAgoMs < GROUP_CALL_STARTED_MS) {
    return isOutgoing ? 'ActionCallGroupStartedYou' : 'ActionCallGroupStarted';
  }
  switch (outcome) {
    case 'declined':
      return isOutgoing ? KEYS.unanswered[kind] : KEYS.declined[kind];
    case 'missed':
      return isOutgoing ? KEYS.unanswered[kind] : KEYS.missed[kind];
    default:
      return isOutgoing ? KEYS.outgoing[kind] : KEYS.incoming[kind];
  }
}
