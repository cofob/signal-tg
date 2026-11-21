/** A Signal notification profile: which chats may notify while it is on, and when it turns on by itself */
export interface ApiNotificationProfile {
  id: string;
  name: string;
  emoji?: string;
  // 0xAARRGGBB
  color: number;
  // Chats whose messages notify while the profile is on
  allowedChatIds: string[];
  areAllCallsAllowed: boolean;
  areAllMentionsAllowed: boolean;
  isScheduleEnabled: boolean;
  // Hours and minutes as a number: 15 is 00:15, 900 is 09:00, 2345 is 23:45
  scheduleStartTime?: number;
  scheduleEndTime?: number;
  // 1 is Monday and 7 is Sunday
  scheduleDays: number[];
}

/** The notification profiles of the account and which one is on */
export interface ApiNotificationProfilesState {
  profiles: ApiNotificationProfile[];
  activeProfileId?: string;
  // Seconds: when the profile that is on turns off, or the next one turns on
  nextChangeAt?: number;
  // Whether the profile is on or off by hand (until `overrideEndsAt` if set) rather than by its schedule
  isManuallyEnabled?: boolean;
  isManuallyDisabled?: boolean;
  overrideEndsAt?: number;
  // Profiles are kept on the primary device of the account only
  isSyncDisabled?: boolean;
}
