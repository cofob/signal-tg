/**
 * Notification profiles: which profile is on, by hand or by its schedule, and what it lets through. Ported from
 * Signal Desktop `ts/types/NotificationProfile.std.ts` and `ts/services/notificationProfilesService.preload.ts`.
 */

// The values of `NotificationProfile.DayOfWeek` of the storage service
export const DAY_MONDAY = 1;
export const DAY_SUNDAY = 7;
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ALL_DAYS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAYS: DayOfWeek[] = [1, 2, 3, 4, 5];
// Signal Desktop `DEFAULT_PROFILE_COLOR`: the A100 background color, as 0xAARRGGBB
export const DEFAULT_PROFILE_COLOR = 0xffe3e3fe;
export const NOTIFICATION_PROFILE_ID_LENGTH = 16;
// Desktop keeps a deleted profile for the time messages wait on the server, so that other devices learn of it
export const DELETED_PROFILE_LIFETIME_MS = 28 * 24 * 60 * 60 * 1000;

export type NotificationProfile = {
  // 32 hexadecimal digits: the 16 bytes of the record's id
  id: string;
  name: string;
  emoji?: string;
  // 0xAARRGGBB
  color: number;
  createdAt: number;
  areAllCallsAllowed: boolean;
  areAllMentionsAllowed: boolean;
  // Conversation ids of the people and groups whose messages come through
  allowedConversationIds: string[];
  // Serialized `Recipient`s of the record that name no conversation here, such as a contact known only by phone number;
  // writing the profile keeps them
  otherAllowedRecipients?: Uint8Array[];
  isScheduleEnabled: boolean;
  // Hours and minutes as a number: 15 is 00:15, 900 is 09:00, 2345 is 23:45
  scheduleStartTime?: number;
  scheduleEndTime?: number;
  scheduleDays: DayOfWeek[];
  // Deleted profiles stay for `DELETED_PROFILE_LIFETIME_MS`
  deletedAt?: number;
};

/** A profile turned on by hand until `endsAt` (or until its schedule ends), or everything turned off by hand */
export type NotificationProfileOverride = {
  disabledAt: number;
  enabled?: undefined;
} | {
  disabledAt?: undefined;
  enabled: { profileId: string; endsAt?: number };
};

export type NextProfileEvent =
  | { type: 'noChange'; activeProfile?: string }
  | { type: 'willDisable'; willDisableAt: number; activeProfile: string; clearEnableOverride?: boolean }
  | { type: 'willEnable'; willEnableAt: number; toEnable: string; clearDisableOverride?: boolean };

export type NotificationProfileState = {
  activeProfile?: NotificationProfile;
  // The override left after clearing one that ran out
  override?: NotificationProfileOverride;
  // When the active profile or the next one changes
  nextChangeAt?: number;
  // Whether the override that ran out was cleared, which has to be stored
  isOverrideCleared?: boolean;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_CLEARS = 3;
const TIME_BASE = 100;

/**
 * Signal Desktop `shouldNotify`: messages of the people and groups a profile allows, mentions and replies when it
 * allows them all, and calls when it allows all of them; without an active profile everything comes through
 */
export function getShouldNotify({
  isCall, isMentionOrReply, conversationId, activeProfile,
}: {
  isCall?: boolean;
  isMentionOrReply?: boolean;
  conversationId: string;
  activeProfile?: NotificationProfile;
}) {
  if (!activeProfile) return true;
  if (isCall && activeProfile.areAllCallsAllowed) return true;
  if (isMentionOrReply && activeProfile.areAllMentionsAllowed) return true;
  return activeProfile.allowedConversationIds.includes(conversationId);
}

/**
 * The profile that is on at `time`, and when that changes next (Desktop `refreshNextEvent`). A manual override that
 * ran out is dropped, as is one whose profile is gone. `profiles` are those that were not deleted.
 */
export function resolveNotificationProfileState(
  profiles: NotificationProfile[], override: NotificationProfileOverride | undefined, time: number,
): NotificationProfileState {
  const sorted = sortProfiles(profiles);
  let current = override;

  for (let attempt = 0; attempt <= MAX_CLEARS; attempt++) {
    let event: NextProfileEvent;
    try {
      event = findNextProfileEvent({ override: current, profiles: sorted, time });
    } catch {
      // Desktop clears an override that something went wrong with
      current = undefined;
      continue;
    }

    if (event.type === 'willDisable' && event.clearEnableOverride && event.willDisableAt <= time) {
      current = undefined;
      continue;
    }
    if (event.type === 'willEnable' && event.clearDisableOverride && event.willEnableAt <= time) {
      current = undefined;
      continue;
    }

    const activeId = event.type === 'willEnable' ? undefined : event.activeProfile;
    return {
      activeProfile: activeId ? sorted.find(({ id }) => id === activeId) : undefined,
      override: current,
      nextChangeAt: event.type === 'willDisable'
        ? event.willDisableAt
        : event.type === 'willEnable' ? event.willEnableAt : undefined,
      isOverrideCleared: current !== override,
    };
  }
  return { override: undefined, isOverrideCleared: override !== undefined };
}

export function sortProfiles(profiles: NotificationProfile[]) {
  // The newest profile takes precedence when schedules overlap
  return [...profiles].sort((a, b) => b.createdAt - a.createdAt);
}

/** Desktop `findNextProfileEvent`; throws when the override names a profile that does not exist */
export function findNextProfileEvent({ override, profiles, time }: {
  override?: NotificationProfileOverride;
  profiles: NotificationProfile[];
  time: number;
}): NextProfileEvent {
  if (override?.enabled?.endsAt) {
    const profile = getProfileById(override.enabled.profileId, profiles);
    // The profile may be on by its schedule right then, but the override still has to be cleared
    return {
      type: 'willDisable', willDisableAt: override.enabled.endsAt, activeProfile: profile.id, clearEnableOverride: true,
    };
  }

  if (override?.enabled) {
    const profile = getProfileById(override.enabled.profileId, profiles);
    const isEnabled = isProfileEnabledBySchedule(time, time - DAY, profile)
      || isProfileEnabledBySchedule(time, time, profile);
    if (isEnabled) {
      const willDisableAt = findNextScheduledDisable(profile, time);
      if (!willDisableAt) throw new Error('A profile on by its schedule does not turn off');
      return {
        type: 'willDisable', willDisableAt, activeProfile: profile.id, clearEnableOverride: true,
      };
    }

    const nextEnableTime = findNextScheduledEnable(profile, time);
    // A profile without a schedule stays on until it is turned off
    if (!nextEnableTime) return { type: 'noChange', activeProfile: profile.id };

    const nextDisableTime = findNextScheduledDisable(profile, nextEnableTime + 1);
    if (!nextDisableTime) throw new Error('A profile that turns on by its schedule does not turn off');
    return {
      type: 'willDisable', activeProfile: profile.id, willDisableAt: nextDisableTime, clearEnableOverride: true,
    };
  }

  if (override?.disabledAt) {
    const next = findNextScheduledEnableForAll(profiles, override.disabledAt + 1);
    if (next) {
      return {
        type: 'willEnable', willEnableAt: next.time, toEnable: next.profile.id, clearDisableOverride: true,
      };
    }
    return { type: 'noChange' };
  }

  const scheduled = findProfileEnabledBySchedule(profiles, time);
  if (scheduled) {
    const disabledAt = findNextScheduledDisable(scheduled, time);
    if (!disabledAt) throw new Error('A profile on by its schedule does not turn off');
    // A newer profile takes over when its schedule starts
    const preempt = findNextScheduledEnableForAll(
      profiles.filter(({ createdAt }) => createdAt > scheduled.createdAt), time + 1,
    );
    return {
      type: 'willDisable',
      activeProfile: scheduled.id,
      willDisableAt: preempt ? Math.min(preempt.time, disabledAt) : disabledAt,
    };
  }

  const next = findNextScheduledEnableForAll(profiles, time);
  if (next) return { type: 'willEnable', willEnableAt: next.time, toEnable: next.profile.id };
  return { type: 'noChange' };
}

/** Whether the schedule of the day of `timeForSchedule` has `time` in it; overnight schedules end the next day */
function isProfileEnabledBySchedule(time: number, timeForSchedule: number, profile: NotificationProfile) {
  const {
    isScheduleEnabled, scheduleDays, scheduleStartTime, scheduleEndTime,
  } = profile;
  if (!isScheduleEnabled || scheduleStartTime === undefined || scheduleEndTime === undefined) return false;
  if (!scheduleDays.includes(getDayOfWeek(timeForSchedule))) return false;

  const midnight = getMidnight(timeForSchedule);
  const start = scheduleToTime(midnight, scheduleStartTime);
  const end = getEndTime(midnight, scheduleStartTime, scheduleEndTime);
  return time >= start && time <= end;
}

function getEndTime(midnight: number, scheduleStartTime: number, scheduleEndTime: number) {
  const start = scheduleToTime(midnight, scheduleStartTime);
  const end = scheduleToTime(midnight, scheduleEndTime);
  return end > start ? end : end + DAY;
}

/** The newest profile whose schedule is on at `time` */
function findProfileEnabledBySchedule(profiles: NotificationProfile[], time: number) {
  return profiles.find((profile) => (
    isProfileEnabledBySchedule(time, time - DAY, profile) || isProfileEnabledBySchedule(time, time, profile)
  ));
}

function findNextScheduledDisable(profile: NotificationProfile, time: number) {
  if (!profile.isScheduleEnabled) return undefined;
  return loopThroughWeek(time, (startOfDay, day) => {
    const { scheduleStartTime, scheduleEndTime } = profile;
    if (!profile.scheduleDays.includes(day) || scheduleStartTime === undefined || scheduleEndTime === undefined) {
      return undefined;
    }
    const end = getEndTime(startOfDay, scheduleStartTime, scheduleEndTime);
    return time < end ? end : undefined;
  });
}

function findNextScheduledEnable(profile: NotificationProfile, time: number) {
  if (!profile.isScheduleEnabled) return undefined;
  return loopThroughWeek(time, (startOfDay, day) => {
    const { scheduleStartTime, scheduleEndTime } = profile;
    if (!profile.scheduleDays.includes(day) || scheduleStartTime === undefined || scheduleEndTime === undefined) {
      return undefined;
    }
    const start = scheduleToTime(startOfDay, scheduleStartTime);
    return time < start ? start : undefined;
  });
}

/** The earliest schedule start of any profile after `time` */
function findNextScheduledEnableForAll(profiles: NotificationProfile[], time: number) {
  let earliest: { profile: NotificationProfile; time: number } | undefined;
  for (const profile of profiles) {
    const result = findNextScheduledEnable(profile, time);
    if (result !== undefined && (!earliest || result < earliest.time)) earliest = { profile, time: result };
  }
  return earliest;
}

/** The first result for the days from yesterday through the next six, in order */
function loopThroughWeek(time: number, check: (startOfDay: number, day: DayOfWeek) => number | undefined) {
  const todayAtMidnight = getMidnight(time);
  const startingDay = getDayOfWeek(time);
  for (let index = -1; index < DAY_SUNDAY; index++) {
    let day = startingDay + index;
    if (day <= 0) day += DAY_SUNDAY;
    if (day > DAY_SUNDAY) day -= DAY_SUNDAY;
    const result = check(todayAtMidnight + DAY * index, day as DayOfWeek);
    if (result !== undefined) return result;
  }
  return undefined;
}

/** Monday is 1 and Sunday 7, as in the storage service */
export function getDayOfWeek(time: number): DayOfWeek {
  const day = new Date(time).getDay();
  return (day === 0 ? DAY_SUNDAY : day) as DayOfWeek;
}

/** 2200 on the day of `midnight` */
export function scheduleToTime(midnight: number, scheduleTime: number) {
  const hours = Math.floor(scheduleTime / TIME_BASE);
  const minutes = scheduleTime % TIME_BASE;
  return midnight + hours * HOUR + minutes * MINUTE;
}

function getMidnight(time: number) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getProfileById(id: string, profiles: NotificationProfile[]) {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error('The profile of the override does not exist');
  return profile;
}
