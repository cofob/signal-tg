import type { CallRecord } from '../db/MessageDb';
import type { SyncMessage_CallEvent, SyncMessage_CallLogEvent } from '../proto/generated/SignalService_pb';

import { bufferToBase64 } from '../../../util/encoding/buffer';
import { uuidToString } from '../serviceId';

import {
  SyncMessage_CallEvent_Direction as ProtoDirection,
  SyncMessage_CallEvent_Event as ProtoEvent,
  SyncMessage_CallEvent_Type as ProtoType,
  SyncMessage_CallLogEvent_Type as ProtoLogType,
} from '../proto/generated/SignalService_pb';

/**
 * The call history rules of Signal Desktop `ts/util/callDisposition.preload.ts` and `ts/types/CallDisposition.std.ts`:
 * how a call event of another device moves a call to its next status. Calls cannot be started or answered here, so
 * only the events that sync messages and group call updates carry (`RemoteCallEvent` and `LocalCallEvent.Started`)
 * are handled.
 */

export type CallMode = 'direct' | 'group';
export type CallType = 'audio' | 'video' | 'group';
export type CallDirection = 'incoming' | 'outgoing';

// The status names are those of Desktop's `CallStatusValue`
export type CallStatus = 'pending' | 'accepted' | 'missed' | 'declined' | 'deleted' | 'genericGroupCall'
  | 'outgoingRing' | 'ringing' | 'joined';

/** The event of a call sync message, and `started` for a group call update */
export type CallEvent = 'accepted' | 'notAccepted' | 'delete' | 'observed' | 'started';

/** A call event with the call it is about, see `getCallEvent` */
export type CallEventDetails = {
  callId: string;
  // The ACI of a 1:1 call, or the id of the group
  peerId: string;
  mode: CallMode;
  type: CallType;
  direction: CallDirection;
  timestamp: number;
  event: CallEvent;
};

export type CallLogEventType = 'clear' | 'markedAsRead' | 'markedAsReadInConversation';

/** The call a call log event is about: the newest call up to `timestamp`, or a named one */
export type CallLogEventTarget = {
  // A 1:1 or group conversation id; `undefined` for every conversation
  peerId?: string;
  callId?: string;
  timestamp: number;
};

export type CallLogEventDetails = {
  type: CallLogEventType;
  target: CallLogEventTarget;
  // Calls to the room of a call link are not stored
  isRoom?: boolean;
};

const GROUP_ID_LENGTH = 32;
const UUID_LENGTH = 16;
const ERA_ID_LENGTH = 16;
const ERA_ID_REGEX = /^[0-9a-f]{16}$/i;
// The call id 0 is reserved: RingRTC treats it as the equally unlikely -1
const MAX_UINT64 = 2n ** 64n - 1n;

const TYPES: Partial<Record<ProtoType, CallType>> = {
  [ProtoType.AUDIO_CALL]: 'audio',
  [ProtoType.VIDEO_CALL]: 'video',
  [ProtoType.GROUP_CALL]: 'group',
};
const DIRECTIONS: Partial<Record<ProtoDirection, CallDirection>> = {
  [ProtoDirection.INCOMING]: 'incoming',
  [ProtoDirection.OUTGOING]: 'outgoing',
};
const EVENTS: Partial<Record<ProtoEvent, CallEvent>> = {
  [ProtoEvent.ACCEPTED]: 'accepted',
  [ProtoEvent.NOT_ACCEPTED]: 'notAccepted',
  [ProtoEvent.DELETE]: 'delete',
  [ProtoEvent.OBSERVED]: 'observed',
};
const LOG_EVENT_TYPES: Partial<Record<ProtoLogType, CallLogEventType>> = {
  [ProtoLogType.CLEAR]: 'clear',
  [ProtoLogType.MARKED_AS_READ]: 'markedAsRead',
  [ProtoLogType.MARKED_AS_READ_IN_CONVERSATION]: 'markedAsReadInConversation',
};

/**
 * The call history event of a `CallEvent` sync message (Desktop `getCallEventForProto`), or `undefined` for events
 * that this device does not keep: calls to call links, which have no chat, and unknown values. The call id is a
 * decimal string, as in Desktop's call history, because it is a 64-bit number.
 */
export function getCallEvent(callEvent: SyncMessage_CallEvent): CallEventDetails | undefined {
  const type = TYPES[callEvent.type];
  const direction = DIRECTIONS[callEvent.direction];
  const event = EVENTS[callEvent.event];
  const peerId = getPeerId(callEvent.conversationId);
  if (!type || !direction || !event || !peerId) return undefined;

  // Direct calls have a 1:1 conversation, group calls a group
  const mode: CallMode = type === 'group' ? 'group' : 'direct';
  if ((mode === 'direct') !== (callEvent.conversationId.length === UUID_LENGTH)) return undefined;
  return {
    callId: String(callEvent.callId), peerId, mode, type, direction, event, timestamp: Number(callEvent.timestamp),
  };
}

/** Desktop `getCallLogEventForProto`; the peer is a conversation or, if it is neither, the room of a call link */
export function getCallLogEvent(callLogEvent: SyncMessage_CallLogEvent): CallLogEventDetails | undefined {
  const type = LOG_EVENT_TYPES[callLogEvent.type];
  if (!type) return undefined;
  const peerId = getPeerId(callLogEvent.conversationId);
  return {
    type,
    target: {
      peerId,
      callId: callLogEvent.callId ? String(callLogEvent.callId) : undefined,
      timestamp: Number(callLogEvent.timestamp),
    },
    isRoom: callLogEvent.conversationId.length > 0 && !peerId,
  };
}

/**
 * Desktop `callIdFromEra` (RingRTC `RingId::from_era_id`): the era id of a group call is 16 hexadecimal digits, the
 * call id their number; other era ids get the first 8 bytes of their SHA-256, little-endian
 */
export async function getCallIdFromEra(eraId: string) {
  let callId: bigint;
  if (eraId.length === ERA_ID_LENGTH && ERA_ID_REGEX.test(eraId)) {
    callId = BigInt(`0x${eraId}`);
  } else {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(eraId)));
    callId = new DataView(hash.buffer).getBigUint64(0, true);
  }
  return String(callId === 0n ? MAX_UINT64 : callId);
}

/**
 * Desktop `transitionCallHistory`: the call after `event`. A call that changed its direction or type is not the
 * same call, and `undefined` rejects the event. Group call updates create calls as incoming, a later `CallEvent` of
 * the device that made the call may correct it to outgoing.
 */
export function transitionCall(call: CallRecord | undefined, event: CallEventDetails): CallRecord | undefined {
  if (call && (call.type !== event.type || call.mode !== event.mode)) return undefined;
  if (call && call.direction !== event.direction && !getIsGroupCallOfUnknownCreator(call)) return undefined;

  const status = event.mode === 'direct'
    ? transitionDirectStatus(call?.status, event.event, event.direction)
    : transitionGroupStatus(call?.status, event.event);
  if (!status) return undefined;

  return {
    ...call,
    callId: event.callId,
    peerId: event.peerId,
    mode: event.mode,
    type: event.type,
    direction: event.direction,
    status,
    timestamp: transitionTimestamp(call, event),
  };
}

/** Desktop `isGroupCallHistoryWithUnknownCreator` */
export function getIsGroupCallOfUnknownCreator(call: CallRecord) {
  return call.mode === 'group' && call.direction === 'incoming' && call.status === 'genericGroupCall'
    && !call.ringerId;
}

/**
 * Whether the call counts as unseen in the call log (Desktop `saveCallHistory`): missed or still pending incoming
 * calls
 */
export function getIsCallUnseen(call: CallRecord) {
  if (call.direction !== 'incoming') return false;
  return call.mode === 'direct'
    ? call.status === 'missed' || call.status === 'pending'
    : call.status === 'ringing' || call.status === 'genericGroupCall' || call.status === 'missed';
}

export function getIsCallDeleted(call: CallRecord) {
  return call.status === 'deleted';
}

/**
 * The call a log event is about (Desktop `getCallHistoryForCallLogEventTarget`): the named call, or, without a call id
 * or conversation, the newest call of the conversation (or of every conversation) up to the target's time
 */
export function findCallForLogEvent(calls: CallRecord[], { peerId, callId, timestamp }: CallLogEventTarget) {
  if (callId && peerId) return calls.find((call) => call.peerId === peerId && call.callId === callId);

  let newest: CallRecord | undefined;
  for (const call of calls) {
    if ((peerId && call.peerId !== peerId) || call.timestamp > timestamp) continue;
    if (!newest || call.timestamp > newest.timestamp) newest = call;
  }
  return newest;
}

/** The id of a conversation named by a call sync message: an ACI for 1:1 calls, a base64 group id for groups */
function getPeerId(bytes: Uint8Array) {
  if (bytes.length === UUID_LENGTH) return uuidToString(bytes);
  return bytes.length === GROUP_ID_LENGTH ? bufferToBase64(bytes) : undefined;
}

function transitionDirectStatus(
  status: CallStatus | undefined, event: CallEvent, direction: CallDirection,
): CallStatus | undefined {
  // A deleted call stays deleted, so that a sync message that arrives late cannot bring it back
  if (event === 'delete' || status === 'deleted') return 'deleted';
  if (event === 'accepted') return 'accepted';
  if (status === 'accepted') return status;
  if (event === 'notAccepted') return status === 'declined' ? 'declined' : 'missed';
  // Desktop: direct calls never send `observed`, and `started` is for group calls
  return undefined;
}

function transitionGroupStatus(status: CallStatus | undefined, event: CallEvent): CallStatus | undefined {
  if (event === 'delete' || status === 'deleted') return 'deleted';
  if (status === 'accepted') return status;
  // Desktop: group calls never send these
  if (event === 'notAccepted' || event === 'observed') return undefined;

  if (event === 'accepted') {
    switch (status) {
      case undefined:
      case 'genericGroupCall':
        return 'joined';
      case 'ringing':
      case 'missed':
      case 'declined':
        return 'accepted';
      case 'joined':
      case 'outgoingRing':
        return status;
      default:
        return undefined;
    }
  }
  // A call that exists keeps its status when a group call update arrives again
  return status ?? 'genericGroupCall';
}

/**
 * Desktop `transitionTimestamp`: a device that sleeps reports old times, so a status that settled keeps its time and
 * changes only by an event of the same kind with a later one
 */
function transitionTimestamp(call: CallRecord | undefined, event: CallEventDetails) {
  if (!call) return event.timestamp;
  const latest = Math.max(event.timestamp, call.timestamp);

  switch (call.status) {
    case 'deleted':
      return call.timestamp;
    case 'accepted':
    case 'joined':
    case 'outgoingRing':
      return event.event === 'accepted' ? latest : call.timestamp;
    case 'declined':
      return event.event === 'notAccepted' ? latest : call.timestamp;
    default:
      return latest;
  }
}
