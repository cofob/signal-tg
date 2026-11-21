import { memo, useEffect, useState } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiNotificationProfile, ApiNotificationProfilesState } from '../../../api/types';
import type { LangFn } from '../../../util/localization';

import { DAY_SUNDAY, WEEKDAYS } from '../../../lib/signal/notificationProfiles/notificationProfiles';
import { formatDateTime } from '../../../util/localization/dateFormat';
import { getWeekdayName } from '../../../util/localization/weekdays';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandDescription } from '../../gili/layout/Island';
import ConfirmDialog from '../../ui/ConfirmDialog';
import ListItem from '../../ui/ListItem';
import Switcher from '../../ui/Switcher';
import NotificationProfileEditorModal from './NotificationProfileEditorModal';

import styles from './SettingsNotificationProfiles.module.scss';

type OwnProps = {
  isActive?: boolean;
  onReset: NoneToVoidFunction;
};

type StateProps = {
  state?: ApiNotificationProfilesState;
};

// The profile being edited by its id, or a new one
type Editing = { profileId: string } | { isNew: true };

const SECONDS_PER_HOUR = 60 * 60;
const MS_PER_SECOND = 1000;
const TIME_BASE = 100;
const WEEKEND = [6, 7];

/**
 * Notification profiles of Signal (Desktop `ts/components/preferences/NotificationProfilesCreateFlow.dom.tsx` and
 * the notification profiles list of its preferences): who notifies while a profile is on, and the schedule that turns
 * it on. They are in the storage service, so they follow the phone, and a profile can be turned on here by hand.
 */
const SettingsNotificationProfiles = ({ isActive, state, onReset }: OwnProps & StateProps) => {
  const {
    loadNotificationProfiles, saveNotificationProfile, deleteNotificationProfile, setNotificationProfileActive,
  } = getActions();

  const lang = useLang();
  const [editing, setEditing] = useState<Editing | undefined>();
  const [deletingId, setDeletingId] = useState<string | undefined>();

  useHistoryBack({ isActive, onBack: onReset });

  useEffect(() => {
    if (isActive) loadNotificationProfiles();
  }, [isActive]);

  const profiles = state?.profiles;
  const editingProfile = editing && 'profileId' in editing
    ? profiles?.find(({ id }) => id === editing.profileId)
    : undefined;
  const deletingProfile = profiles?.find(({ id }) => id === deletingId);

  const handleNew = useLastCallback(() => {
    setEditing({ isNew: true });
  });

  const handleCloseEditor = useLastCallback(() => {
    setEditing(undefined);
  });

  const handleSave = useLastCallback((profile: Omit<ApiNotificationProfile, 'id'> & { id?: string }) => {
    saveNotificationProfile({ profile });
    setEditing(undefined);
  });

  const handleConfirmDelete = useLastCallback(() => {
    if (deletingId) deleteNotificationProfile({ id: deletingId });
    setDeletingId(undefined);
  });

  const handleCloseDelete = useLastCallback(() => {
    setDeletingId(undefined);
  });

  // Turning a profile on or off does not open it; list items act on the press, not the click
  const handleStopPropagation = useLastCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  });

  const handleToggle = useLastCallback((id: string, isOn: boolean) => {
    setNotificationProfileActive(isOn ? { id } : {});
  });

  const handleTurnOnForHour = useLastCallback((id: string) => {
    setNotificationProfileActive({ id, endsAt: Math.floor(Date.now() / MS_PER_SECOND) + SECONDS_PER_HOUR });
  });

  return (
    <div className="settings-content custom-scroll">
      <p className={styles.info}>{lang('NotificationProfilesInfo')}</p>

      {state?.isSyncDisabled && (
        <IslandDescription>{lang('NotificationProfilesSyncOff')}</IslandDescription>
      )}

      <Island>
        {profiles?.map((profile) => (
          <ListItem
            key={profile.id}
            narrow
            leftElement={<div className={styles.emoji}>{profile.emoji || '🔕'}</div>}
            rightElement={(
              <div className={styles.switcher} onMouseDown={handleStopPropagation} onClick={handleStopPropagation}>
                <Switcher
                  id={`notification-profile-${profile.id}`}
                  label={profile.name}
                  checked={state?.activeProfileId === profile.id}
                  onCheck={(isOn) => handleToggle(profile.id, isOn)}
                />
              </div>
            )}
            contextActions={[
              {
                title: lang('NotificationProfileForHour'),
                icon: 'clock',
                handler: () => handleTurnOnForHour(profile.id),
              },
              {
                title: lang('Delete'),
                icon: 'delete',
                destructive: true,
                handler: () => setDeletingId(profile.id),
              },
            ]}
            onClick={() => setEditing({ profileId: profile.id })}
          >
            <div className="multiline-item">
              <span className="title">{profile.name}</span>
              <span className="subtitle">{getSubtitle(lang, profile, state)}</span>
            </div>
          </ListItem>
        ))}
        {!state?.isSyncDisabled && (
          <ListItem icon="add" narrow onClick={handleNew}>
            {lang('NotificationProfileNew')}
          </ListItem>
        )}
      </Island>

      <NotificationProfileEditorModal
        isOpen={Boolean(editing)}
        profile={editingProfile}
        onSave={handleSave}
        onClose={handleCloseEditor}
      />
      <ConfirmDialog
        isOpen={Boolean(deletingProfile)}
        title={lang('NotificationProfileDelete')}
        text={deletingProfile ? lang('NotificationProfileDeleteInfo', { name: deletingProfile.name }) : undefined}
        confirmHandler={handleConfirmDelete}
        confirmIsDestructive
        confirmLabel={lang('Delete')}
        onClose={handleCloseDelete}
      />
    </div>
  );
};

/** Whether the profile is on, until when, and its schedule (Desktop `NotificationProfile--edit--*`) */
function getSubtitle(lang: LangFn, profile: ApiNotificationProfile, state?: ApiNotificationProfilesState) {
  const parts: string[] = [];
  if (state?.activeProfileId === profile.id) {
    const endsAt = state.overrideEndsAt ?? state.nextChangeAt;
    const time = endsAt && formatDateTime(lang, new Date(endsAt * MS_PER_SECOND), { time: 'short' });
    parts.push(time ? lang('NotificationProfileOnUntil', { time }) : lang('NotificationProfileOn'));
  }
  if (profile.isScheduleEnabled && profile.scheduleStartTime !== undefined && profile.scheduleEndTime !== undefined) {
    parts.push(`${getDaysLabel(lang, profile.scheduleDays)}, ${
      formatScheduleTime(lang, profile.scheduleStartTime)} - ${formatScheduleTime(lang, profile.scheduleEndTime)}`);
  }
  if (!parts.length) parts.push(lang('NotificationProfileOff'));
  return parts.join(' · ');
}

function getDaysLabel(lang: LangFn, days: number[]) {
  if (days.length === DAY_SUNDAY) return lang('NotificationProfileDaily');
  if (days.length === WEEKDAYS.length && WEEKDAYS.every((day) => days.includes(day))) {
    return lang('NotificationProfileWeekdays');
  }
  if (days.length === WEEKEND.length && WEEKEND.every((day) => days.includes(day))) {
    return lang('NotificationProfileWeekends');
  }
  return [...days].sort().map((day) => getWeekdayName(lang.code, day)).join(', ');
}

function formatScheduleTime(lang: LangFn, time: number) {
  const date = new Date(2024, 0, 1, Math.floor(time / TIME_BASE), time % TIME_BASE);
  return formatDateTime(lang, date, { time: 'short' });
}

export default memo(withGlobal<OwnProps>((global): Complete<StateProps> => ({
  state: global.notificationProfiles,
}))(SettingsNotificationProfiles));
