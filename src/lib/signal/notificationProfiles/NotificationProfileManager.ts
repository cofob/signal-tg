import type { StorageChanges } from '../storage/storageRecords';
import type SignalStore from '../store/SignalStore';
import type { NotificationProfile, NotificationProfileOverride } from './notificationProfiles';

import { bufferToHex } from '../../../util/encoding/buffer';
import { getRandomBytes } from '../crypto';
import { ACCOUNT_KEY, getNotificationProfileKey } from '../storage/storageRecords';
import {
  DEFAULT_PROFILE_COLOR,
  DELETED_PROFILE_LIFETIME_MS,
  NOTIFICATION_PROFILE_ID_LENGTH,
  resolveNotificationProfileState,
} from './notificationProfiles';

/** What the app needs to know about the profiles at one time */
export type NotificationProfilesState = {
  // The profiles that were not deleted, oldest first
  profiles: NotificationProfile[];
  activeProfileId?: string;
  // When the profile that is on turns off, or the next one turns on
  nextChangeAt?: number;
  // Whether the profile was turned on or off by hand, and until when
  override?: NotificationProfileOverride;
  isSyncDisabled?: boolean;
};

/** A profile to save: a new one has no id, and gets one with its creation time */
export type NotificationProfileDraft = Omit<NotificationProfile, 'id' | 'createdAt'>
  & Partial<Pick<NotificationProfile, 'id' | 'createdAt'>>;

/** What notification profiles need of `MessageProcessor`, which serializes the changes of stored state */
export type NotificationProfileHost = {
  store: SignalStore;
  markStorageChanges(changes: StorageChanges): Promise<void>;
  runSerial<T>(task: () => Promise<T>): Promise<T>;
  onChange(state: NotificationProfilesState): void;
};

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * The notification profiles of the storage service and the manual override of the account record (Signal Desktop
 * `NotificationProfilesService` in `ts/services/notificationProfilesService.preload.ts`): which profile is on now, and
 * a timer for the next time that changes. Desktop's setting to keep profiles on one device (`notificationProfileSync
 * Disabled`) is not supported: an account that sets it has no profiles here, because its records belong to the
 * primary device.
 */
export default class NotificationProfileManager {
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private host: NotificationProfileHost) {}

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** The state at this time; an override that ran out is cleared first */
  async refresh(isForced?: boolean) {
    const { store } = this.host;
    const isSyncDisabled = await store.getItem('isNotificationProfileSyncDisabled');
    const profiles = isSyncDisabled ? [] : await this.getLiveProfiles();
    const override = await store.getItem('notificationProfileOverride');

    const state = resolveNotificationProfileState(profiles, override, Date.now());
    if (state.isOverrideCleared) await this.storeOverride(state.override);

    this.scheduleRefresh(state.nextChangeAt);
    const result: NotificationProfilesState = {
      profiles: [...profiles].sort((a, b) => a.createdAt - b.createdAt),
      activeProfileId: state.activeProfile?.id,
      nextChangeAt: state.nextChangeAt,
      override: state.override,
      isSyncDisabled: isSyncDisabled || undefined,
    };
    if (isForced || state.isOverrideCleared) this.host.onChange(result);
    return result;
  }

  /** Creates or changes a profile; other devices learn it through the storage service */
  async saveProfile(draft: NotificationProfileDraft) {
    const { store } = this.host;
    const profiles = await store.getItem('notificationProfiles') ?? [];
    const existing = draft.id ? profiles.find(({ id }) => id === draft.id) : undefined;
    const profile: NotificationProfile = {
      ...draft,
      id: draft.id ?? bufferToHex(getRandomBytes(NOTIFICATION_PROFILE_ID_LENGTH)),
      color: draft.color || DEFAULT_PROFILE_COLOR,
      createdAt: existing?.createdAt ?? Date.now(),
      // Recipients of the record that name nobody here stay with the profile
      otherAllowedRecipients: existing?.otherAllowedRecipients,
    };
    await store.setItem('notificationProfiles', [...profiles.filter(({ id }) => id !== profile.id), profile]);
    await this.host.markStorageChanges({ [getNotificationProfileKey(profile.id)]: ['notificationProfile'] });
    await this.refresh(true);
    return profile;
  }

  /** Deleted profiles stay for a time, so that other devices learn of it (Desktop `deletedAtTimestampMs`) */
  async deleteProfile(id: string) {
    const { store } = this.host;
    const profiles = await store.getItem('notificationProfiles') ?? [];
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;

    await store.setItem('notificationProfiles', [
      ...profiles.filter((item) => item.id !== id), { ...profile, deletedAt: Date.now() },
    ]);
    await this.host.markStorageChanges({ [getNotificationProfileKey(id)]: ['notificationProfile'] });
    // An override that names the profile ends with it
    const override = await store.getItem('notificationProfileOverride');
    if (override?.enabled?.profileId === id) await this.storeOverride(undefined);
    await this.refresh(true);
  }

  /** Turns a profile on by hand, until `endsAt` if given; turns profiles off by hand without a profile */
  async setOverride(profileId: string | undefined, endsAt?: number) {
    await this.storeOverride(profileId ? { enabled: { profileId, endsAt } } : { disabledAt: Date.now() });
    await this.refresh(true);
  }

  /**
   * Takes in what the storage service has: profiles that changed on no device here, and, when the batch has the
   * account record, its override unless this device changed it since the last write
   */
  async mergeRemote(
    remoteProfiles: NotificationProfile[],
    account?: { override?: NotificationProfileOverride; isOverrideChanged: boolean; isSyncDisabled: boolean },
  ) {
    const { store } = this.host;
    if (remoteProfiles.length) {
      const local = await store.getItem('notificationProfiles') ?? [];
      const remoteIds = new Set(remoteProfiles.map(({ id }) => id));
      // A profile that was deleted anywhere stays deleted, since the earliest deletion wins (Desktop
      // `getEarliestTimestamp`)
      const merged = remoteProfiles.map((remote) => {
        const localDeletedAt = local.find(({ id }) => id === remote.id)?.deletedAt;
        const deletedAt = [localDeletedAt, remote.deletedAt].filter((time) => time !== undefined);
        return { ...remote, deletedAt: deletedAt.length ? Math.min(...deletedAt) : undefined };
      });
      await store.setItem('notificationProfiles', [...local.filter(({ id }) => !remoteIds.has(id)), ...merged]);
    }
    if (account) {
      await store.setItem('isNotificationProfileSyncDisabled', account.isSyncDisabled);
      if (!account.isOverrideChanged) {
        if (account.override) await store.setItem('notificationProfileOverride', account.override);
        else await store.removeItem('notificationProfileOverride');
      }
    }
    await this.refresh(true);
  }

  /** The profiles that were not deleted, and those that were deleted a short time ago leave the store later */
  private async getLiveProfiles() {
    const { store } = this.host;
    const all = await store.getItem('notificationProfiles') ?? [];
    const now = Date.now();
    const expired = all.filter(({ deletedAt }) => deletedAt && now - deletedAt > DELETED_PROFILE_LIFETIME_MS);
    if (expired.length) {
      await store.setItem('notificationProfiles', all.filter((profile) => !expired.includes(profile)));
    }
    return all.filter(({ deletedAt }) => !deletedAt);
  }

  private async storeOverride(override?: NotificationProfileOverride) {
    const { store } = this.host;
    if (override) await store.setItem('notificationProfileOverride', override);
    else await store.removeItem('notificationProfileOverride');
    await this.host.markStorageChanges({ [ACCOUNT_KEY]: ['notificationProfileManualOverride'] });
  }

  private scheduleRefresh(nextChangeAt?: number) {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (nextChangeAt === undefined) return;
    this.timer = setTimeout(() => {
      void this.host.runSerial(() => this.refresh(true));
    }, Math.min(Math.max(nextChangeAt - Date.now(), 0), MAX_TIMEOUT_MS));
  }
}
