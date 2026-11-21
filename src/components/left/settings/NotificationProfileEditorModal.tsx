import type { ChangeEvent } from 'react';
import {
  memo, useEffect, useMemo, useState,
} from '../../../lib/teact/teact';

import type { ApiNotificationProfile } from '../../../api/types';

import {
  ALL_DAYS, DEFAULT_PROFILE_COLOR, WEEKDAYS,
} from '../../../lib/signal/notificationProfiles/notificationProfiles';
import { getWeekdayName } from '../../../util/localization/weekdays';

import useFlag from '../../../hooks/useFlag';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';
import InputText from '../../ui/InputText';
import ListItem from '../../ui/ListItem';
import Modal from '../../ui/Modal';
import NotificationProfileChatsModal from './NotificationProfileChatsModal';

import styles from './NotificationProfileEditorModal.module.scss';

type OwnProps = {
  isOpen?: boolean;
  // `undefined` while a new profile is made
  profile?: ApiNotificationProfile;
  onSave: (profile: Omit<ApiNotificationProfile, 'id'> & { id?: string }) => void;
  onClose: NoneToVoidFunction;
};

const MAX_NAME_LENGTH = 32;
const MAX_EMOJI_LENGTH = 8;
const TIME_BASE = 100;
const DEFAULT_START_TIME = 900;
const DEFAULT_END_TIME = 1700;

/** Makes and changes a notification profile: its name, who notifies while it is on, and when it turns on by itself */
const NotificationProfileEditorModal = ({
  isOpen,
  profile,
  onSave,
  onClose,
}: OwnProps) => {
  const lang = useLang();
  const [isChatsOpen, openChats, closeChats] = useFlag();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [chatIds, setChatIds] = useState<string[]>([]);
  const [areAllMentionsAllowed, setAreAllMentionsAllowed] = useState(false);
  const [areAllCallsAllowed, setAreAllCallsAllowed] = useState(false);
  const [isScheduleEnabled, setIsScheduleEnabled] = useState(false);
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [days, setDays] = useState<number[]>(WEEKDAYS);

  // The form starts again when the editor opens or shows another profile, not when the profile changes meanwhile
  const resetForm = useLastCallback(() => {
    setName(profile?.name ?? '');
    setEmoji(profile?.emoji ?? '');
    setChatIds(profile?.allowedChatIds ?? []);
    setAreAllMentionsAllowed(profile?.areAllMentionsAllowed ?? false);
    setAreAllCallsAllowed(profile?.areAllCallsAllowed ?? false);
    setIsScheduleEnabled(profile?.isScheduleEnabled ?? false);
    setStartTime(profile?.scheduleStartTime ?? DEFAULT_START_TIME);
    setEndTime(profile?.scheduleEndTime ?? DEFAULT_END_TIME);
    setDays(profile?.scheduleDays.length ? profile.scheduleDays : WEEKDAYS);
  });

  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen, profile?.id]);

  const handleNameChange = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    setName(e.currentTarget.value);
  });

  const handleEmojiChange = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    setEmoji(e.currentTarget.value);
  });

  const handleStartTimeChange = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    setStartTime(parseTimeInput(e.currentTarget.value, startTime));
  });

  const handleEndTimeChange = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    setEndTime(parseTimeInput(e.currentTarget.value, endTime));
  });

  const handleChatsSave = useLastCallback((ids: string[]) => {
    setChatIds(ids);
    closeChats();
  });

  const handleSave = useLastCallback(() => {
    onSave({
      id: profile?.id,
      name: name.trim(),
      emoji: emoji.trim() || undefined,
      color: profile?.color ?? DEFAULT_PROFILE_COLOR,
      allowedChatIds: chatIds,
      areAllCallsAllowed,
      areAllMentionsAllowed,
      isScheduleEnabled,
      scheduleStartTime: isScheduleEnabled ? startTime : undefined,
      scheduleEndTime: isScheduleEnabled ? endTime : undefined,
      scheduleDays: isScheduleEnabled ? days : [],
    });
  });

  const dayButtons = useMemo(() => (
    ALL_DAYS.map((day) => ({ day, label: getWeekdayName(lang.code, day) }))
  ), [lang.code]);
  const isInvalid = !name.trim() || (isScheduleEnabled && (!days.length || startTime === endTime));

  return (
    <Modal
      isOpen={isOpen}
      title={lang(profile ? 'NotificationProfileEdit' : 'NotificationProfileNew')}
      hasCloseButton
      onClose={onClose}
    >
      <div className={styles.name}>
        <InputText
          className={styles.emoji}
          value={emoji}
          label={lang('NotificationProfileEmoji')}
          maxLength={MAX_EMOJI_LENGTH}
          onChange={handleEmojiChange}
        />
        <InputText
          value={name}
          label={lang('NotificationProfileName')}
          maxLength={MAX_NAME_LENGTH}
          onChange={handleNameChange}
        />
      </div>

      <ListItem icon="group" narrow onClick={openChats}>
        <div className="multiline-item">
          <span className="title">{lang('NotificationProfileAllowed')}</span>
          <span className="subtitle">
            {chatIds.length
              ? lang('NotificationProfileChats', { count: chatIds.length }, { pluralValue: chatIds.length })
              : lang('NotificationProfileNobody')}
          </span>
        </div>
      </ListItem>
      <Checkbox
        label={lang('NotificationProfileMentions')}
        checked={areAllMentionsAllowed}
        onCheck={setAreAllMentionsAllowed}
      />
      <Checkbox
        label={lang('NotificationProfileCalls')}
        checked={areAllCallsAllowed}
        onCheck={setAreAllCallsAllowed}
      />
      <Checkbox
        label={lang('NotificationProfileSchedule')}
        checked={isScheduleEnabled}
        onCheck={setIsScheduleEnabled}
      />
      {isScheduleEnabled && (
        <div className={styles.schedule}>
          <div className={styles.days}>
            {dayButtons.map(({ day, label }) => (
              <Button
                key={day}
                size="tiny"
                className={styles.day}
                pill
                color={days.includes(day) ? 'primary' : 'translucent'}
                ariaLabel={label}
                onClick={() => setDays(days.includes(day) ? days.filter((item) => item !== day) : [...days, day])}
              >
                {label}
              </Button>
            ))}
          </div>
          <label className={styles.time}>
            {lang('NotificationProfileFrom')}
            <input
              type="time"
              className={styles.timeInput}
              value={formatTimeInput(startTime)}
              onChange={handleStartTimeChange}
            />
          </label>
          <label className={styles.time}>
            {lang('NotificationProfileUntil')}
            <input
              type="time"
              className={styles.timeInput}
              value={formatTimeInput(endTime)}
              onChange={handleEndTimeChange}
            />
          </label>
        </div>
      )}

      <div className="dialog-buttons">
        <Button color="primary" className="confirm-dialog-button" isText disabled={isInvalid} onClick={handleSave}>
          {lang('Save')}
        </Button>
        <Button className="confirm-dialog-button" isText onClick={onClose}>{lang('Cancel')}</Button>
      </div>

      <NotificationProfileChatsModal
        isOpen={isChatsOpen}
        chatIds={chatIds}
        onSave={handleChatsSave}
        onClose={closeChats}
      />
    </Modal>
  );
};

/** `09:30` of the time number 930 */
function formatTimeInput(time: number) {
  const hours = Math.floor(time / TIME_BASE);
  const minutes = time % TIME_BASE;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The time number 930 of `09:30`; an empty input keeps the time */
function parseTimeInput(value: string, fallback: number) {
  const [hours, minutes] = value.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * TIME_BASE + minutes : fallback;
}

export default memo(NotificationProfileEditorModal);
