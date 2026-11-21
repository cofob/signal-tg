import type { ChangeEvent } from 'react';
import { memo, useEffect, useMemo, useRef, useState } from '../../../lib/teact/teact';
import { getActions, getPromiseActions, withGlobal } from '../../../global';

import type { ApiBackupFrequency, ApiBackupRemoteStatus, ApiBackupSettings } from '../../../api/types';
import type { RegularLangKey } from '../../../types/language';

import { formatDateTime } from '../../../util/localization/dateFormat';
import { formatFileSize } from '../../../util/text/textFormat';

import useFlag from '../../../hooks/useFlag';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandDescription, IslandTitle } from '../../gili/layout/Island';
import ConfirmDialog from '../../ui/ConfirmDialog';
import InputText from '../../ui/InputText';
import ListItem from '../../ui/ListItem';
import Loading from '../../ui/Loading';
import RadioGroup from '../../ui/RadioGroup';

type OwnProps = {
  isActive?: boolean;
  onReset: NoneToVoidFunction;
};

type StateProps = {
  backups?: ApiBackupSettings;
  backupRemote?: ApiBackupRemoteStatus;
};

const FREQUENCIES: ApiBackupFrequency[] = ['daily', 'weekly', 'monthly', 'manual'];
const PERCENT = 100;
// The level of the free tier of Signal Secure Backups (zkgroup `BackupLevel::Free`)
const FREE_TIER = 200;

const SettingsBackups = ({
  isActive,
  backups,
  backupRemote,
  onReset,
}: OwnProps & StateProps) => {
  const {
    loadBackupSettings, loadBackupRemoteStatus, backUpNow, cancelBackup, exportBackupFile, importBackupFile,
    setBackupFrequency, openRecoveryKeyModal,
  } = getActions();
  const lang = useLang();

  const fileInputRef = useRef<HTMLInputElement>();
  const [isTurnOffDialogOpen, openTurnOffDialog, closeTurnOffDialog] = useFlag();
  const [isImportDialogOpen, openImportDialog, closeImportDialog] = useFlag();
  const [isUpdating, startUpdating, stopUpdating] = useFlag();
  const [recoveryKey, setRecoveryKey] = useState('');

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  useEffect(() => {
    if (!isActive) return;
    loadBackupSettings();
    loadBackupRemoteStatus();
  }, [isActive]);

  const frequencyOptions = useMemo(() => FREQUENCIES.map((value) => ({
    value,
    label: lang(FREQUENCY_KEYS[value]),
  })), [lang]);

  const handleTurnOn = useLastCallback(async () => {
    startUpdating();
    await getPromiseActions().enableBackups({ frequency: backups?.frequency ?? 'daily' });
    stopUpdating();
  });

  const handleTurnOff = useLastCallback(async (shouldDeleteBackup: boolean) => {
    closeTurnOffDialog();
    startUpdating();
    await getPromiseActions().disableBackups({ shouldDeleteBackup });
    stopUpdating();
  });

  const handleTurnOffAndDelete = useLastCallback(() => handleTurnOff(true));

  const handleFrequencyChange = useLastCallback((value: string) => {
    setBackupFrequency({ frequency: value as ApiBackupFrequency });
  });

  const handleOpenRecoveryKey = useLastCallback(() => {
    openRecoveryKeyModal();
  });

  const handleRecoveryKeyInput = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    setRecoveryKey(e.currentTarget.value);
  });

  // Choosing the file follows the click on the button of the dialog, which lets the browser open the picker
  const handleChooseFile = useLastCallback(() => {
    fileInputRef.current?.click();
  });

  const handleFileChange = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    closeImportDialog();
    if (!file) return;
    importBackupFile({ file, recoveryKey });
    setRecoveryKey('');
  });

  function renderProgress() {
    const { progress } = backups!;
    if (!progress) return lang('BackupsStepExporting');
    if (progress.step === 'exporting') return lang('BackupsStepExporting');
    if (progress.step === 'validating') return lang('BackupsStepValidating');
    return lang('BackupsStepUploading', { percent: `${Math.floor((progress.progress ?? 0) * PERCENT)}%` });
  }

  function renderStatus() {
    const { lastBackupAt, lastBackupSize, lastError } = backups!;
    const last = lastBackupAt
      ? `${formatDateTime(lang, new Date(lastBackupAt))}${lastBackupSize
        ? `, ${formatFileSize(lang, lastBackupSize)}` : ''}`
      : lang('BackupsNever');

    return (
      <Island>
        <ListItem icon="clock" multiline narrow>
          <span className="title">{lang('BackupsLastBackup')}</span>
          <span className="subtitle">{backups!.isRunning ? renderProgress() : last}</span>
        </ListItem>
        {backupRemote && (
          <ListItem icon="cloud-download" multiline narrow>
            <span className="title">{lang('BackupsOnServer')}</span>
            <span className="subtitle">
              {backupRemote.hasBackup && backupRemote.size !== undefined
                ? `${backupRemote.modifiedAt ? `${formatDateTime(lang, new Date(backupRemote.modifiedAt))}, ` : ''}${
                  formatFileSize(lang, backupRemote.size)}`
                : lang('BackupsOnServerNone')}
            </span>
          </ListItem>
        )}
        {lastError && !backups!.isRunning && (
          <ListItem icon="warning" multiline narrow>
            <span className="title">{lang('BackupsLastFailed')}</span>
            <span className="subtitle">{lang(ERROR_KEYS[lastError] ?? 'ErrorUnexpected')}</span>
          </ListItem>
        )}
        {backups!.isPrimary && (backups!.isRunning ? (
          <ListItem icon="close" narrow destructive onClick={() => cancelBackup()}>
            {lang('BackupsCancel')}
          </ListItem>
        ) : (
          <ListItem icon="reload" narrow disabled={isUpdating} onClick={() => backUpNow()}>
            {lang('BackupsBackUpNow')}
          </ListItem>
        ))}
      </Island>
    );
  }

  function renderEnabled() {
    return (
      <>
        {renderStatus()}
        <IslandDescription dir="auto">
          {lang(backups!.tier !== undefined && backups!.tier !== FREE_TIER ? 'BackupsTierPaid' : 'BackupsTierFree')}
        </IslandDescription>
        <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('BackupsFrequency')}</IslandTitle>
        <Island>
          <RadioGroup
            name="backupFrequency"
            options={frequencyOptions}
            selected={backups!.frequency}
            disabled={isUpdating}
            onChange={handleFrequencyChange}
          />
        </Island>
        <Island>
          {backups!.isPrimary && (
            <ListItem icon="key" narrow onClick={handleOpenRecoveryKey}>
              {lang('BackupsRecoveryKey')}
            </ListItem>
          )}
          <ListItem
            icon="delete"
            narrow
            destructive
            disabled={isUpdating || backups!.isRunning}
            onClick={openTurnOffDialog}
          >
            {lang('BackupsTurnOff')}
          </ListItem>
        </Island>
        {backups!.isPrimary && <IslandDescription dir="auto">{lang('BackupsRecoveryKeyAbout')}</IslandDescription>}
      </>
    );
  }

  // A linked device does not write backups, as it could replace the backup that its phone needs
  function renderLinked() {
    return (
      <>
        <IslandDescription dir="auto">{lang('BackupsLinkedDevice')}</IslandDescription>
        {renderStatus()}
      </>
    );
  }

  function renderDisabled() {
    return (
      <>
        <IslandDescription dir="auto">{lang('BackupsAbout')}</IslandDescription>
        <Island>
          <ListItem icon="archive" narrow disabled={isUpdating} onClick={handleTurnOn}>
            {lang('BackupsTurnOn')}
          </ListItem>
        </Island>
        <IslandDescription dir="auto">{lang('BackupsTierFree')}</IslandDescription>
      </>
    );
  }

  function renderFile() {
    return (
      <>
        <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('BackupsFile')}</IslandTitle>
        <Island>
          <ListItem
            icon="download"
            narrow
            disabled={isUpdating || backups!.isRunning}
            onClick={() => exportBackupFile()}
          >
            {lang('BackupsExportFile')}
          </ListItem>
          <ListItem icon="unarchive" narrow disabled={isUpdating || backups!.isRunning} onClick={openImportDialog}>
            {lang('BackupsImportFile')}
          </ListItem>
        </Island>
        <IslandDescription dir="auto">{lang('BackupsFileAbout')}</IslandDescription>
      </>
    );
  }

  return (
    <div className="settings-content custom-scroll">
      {!backups && <Loading />}
      {backups?.unavailableReason && (
        <IslandDescription dir="auto">
          {lang(backups.unavailableReason === 'noRecoveryKey'
            ? 'BackupsUnavailableNoRecoveryKey' : 'BackupsUnavailableNoMediaKey')}
        </IslandDescription>
      )}
      {backups && !backups.unavailableReason && (
        <>
          {!backups.isPrimary && renderLinked()}
          {backups.isPrimary && (backups.isEnabled ? renderEnabled() : renderDisabled())}
          {renderFile()}
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".backup,application/octet-stream"
        onChange={handleFileChange}
      />
      <ConfirmDialog
        isOpen={isTurnOffDialogOpen}
        title={lang('BackupsTurnOff')}
        text={lang('BackupsTurnOffText')}
        confirmLabel={lang('BackupsTurnOffDelete')}
        confirmIsDestructive
        confirmHandler={handleTurnOffAndDelete}
        onClose={closeTurnOffDialog}
      />
      <ConfirmDialog
        isOpen={isImportDialogOpen}
        title={lang('BackupsImportFile')}
        confirmLabel={lang('BackupsImportChoose')}
        isConfirmDisabled={!recoveryKey.trim()}
        confirmHandler={handleChooseFile}
        onClose={closeImportDialog}
      >
        <p>{lang('BackupsImportText')}</p>
        <p>{lang('BackupsImportMergeNote')}</p>
        <InputText
          value={recoveryKey}
          placeholder={lang('BackupsRecoveryKey')}
          autoComplete="off"
          autoFocus
          onChange={handleRecoveryKeyInput}
        />
      </ConfirmDialog>
    </div>
  );
};

const FREQUENCY_KEYS = {
  daily: 'BackupsFrequencyDaily',
  weekly: 'BackupsFrequencyWeekly',
  monthly: 'BackupsFrequencyMonthly',
  manual: 'BackupsFrequencyManual',
} as const;

// The reasons of `BackupService.noteFailure`, as the strings that explain them
const ERROR_KEYS: Record<string, RegularLangKey> = {
  rateLimited: 'BackupsErrorRateLimited',
  server: 'BackupsErrorNetwork',
  unexpected: 'BackupsErrorNetwork',
  tooLarge: 'BackupsErrorNetwork',
  svrb: 'BackupsErrorNetwork',
  unauthorized: 'BackupsErrorRejected',
  verificationFailed: 'BackupsErrorRejected',
  notFound: 'BackupsErrorNotEnabled',
  validation: 'BackupsErrorInvalidBackup',
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => ({
    backups: global.settings.byKey.backups,
    backupRemote: global.settings.byKey.backupRemote,
  }),
)(SettingsBackups));
