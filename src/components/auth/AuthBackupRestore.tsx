import type { ChangeEvent } from 'react';
import { memo, useRef, useState } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiBackupRestoreState } from '../../api/types';

import { formatDateTime } from '../../util/localization/dateFormat';
import { formatFileSize } from '../../util/text/textFormat';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import InputText from '../ui/InputText';
import Loading from '../ui/Loading';

import styles from './AuthBackupRestore.module.scss';

type StateProps = {
  backupRestore?: ApiBackupRestoreState;
  errorKey?: Parameters<ReturnType<typeof useLang>['withRegular']>[0];
};

const PERCENT = 100;

/**
 * The registration step that offers to restore a backup of the account with its recovery key (Signal Android
 * registration `EnterAepForRemoteBackupPostRegistrationViewModel` and `RemoteBackupRestoreViewModel`): the key
 * is checked on the backup service, then the backup is downloaded, validated and imported
 */
const AuthBackupRestore = ({ backupRestore, errorKey }: StateProps) => {
  const { restoreAuthBackup, skipAuthRestore, clearAuthErrorKey } = getActions();
  const lang = useLang();

  const fileInputRef = useRef<HTMLInputElement>();
  const [recoveryKey, setRecoveryKey] = useState('');

  const step = backupRestore?.step;
  const isBusy = Boolean(step);
  const progress = backupRestore?.progress ?? 0;
  const percent = `${Math.floor(progress * PERCENT)}%`;

  const handleKeyChange = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (errorKey) clearAuthErrorKey();
    setRecoveryKey(e.target.value);
  });

  const handleSubmit = useLastCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isBusy || !recoveryKey.trim()) return;
    restoreAuthBackup({ recoveryKey });
  });

  const handleChooseFile = useLastCallback(() => {
    fileInputRef.current?.click();
  });

  const handleFileChange = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file && recoveryKey.trim()) restoreAuthBackup({ recoveryKey, file });
  });

  function renderStep() {
    switch (step) {
      case 'downloading':
        return lang('AuthRestoreStepDownloading', { percent });
      case 'validating':
        return lang('AuthRestoreStepValidating');
      case 'importing':
        return lang('AuthRestoreStepImporting', { percent });
      default:
        return lang('AuthRestoreStepVerifying');
    }
  }

  const found = backupRestore?.found;
  const hasProgress = step === 'downloading' || step === 'importing';

  return (
    <div id="auth-restore-form" className="custom-scroll">
      <div className="auth-form">
        <form action="" method="post" onSubmit={handleSubmit}>
          <h2>{lang('AuthRestoreTitle')}</h2>
          <p className="note">{lang('AuthRestoreText')}</p>
          <InputText
            id="restore-recovery-key"
            label={lang('AuthRestoreKey')}
            value={recoveryKey}
            disabled={isBusy}
            error={errorKey && lang.withRegular(errorKey)}
            autoComplete="off"
            onChange={handleKeyChange}
          />
          {isBusy && (
            <div className={styles.status}>
              {hasProgress ? (
                <div className={styles.track}>
                  <div className={styles.fill} style={`transform: scaleX(${progress})`} />
                </div>
              ) : <Loading />}
              <p className={styles.hint}>{renderStep()}</p>
              {found && (
                <p className={styles.hint}>
                  {lang('AuthRestoreFound', {
                    date: found.modifiedAt ? formatDateTime(lang, new Date(found.modifiedAt)) : '',
                    size: formatFileSize(lang, found.size),
                  })}
                </p>
              )}
            </div>
          )}
          {!isBusy && (
            <>
              <Button type="submit" ripple disabled={!recoveryKey.trim()}>{lang('AuthRestoreButton')}</Button>
              <Button isText disabled={!recoveryKey.trim()} onClick={handleChooseFile}>
                {lang('AuthRestoreFile')}
              </Button>
              <Button isText onClick={() => skipAuthRestore()}>{lang('AuthRestoreSkip')}</Button>
            </>
          )}
        </form>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".backup,application/octet-stream"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
};

export default memo(withGlobal(
  (global): Complete<StateProps> => ({
    backupRestore: global.auth.backupRestore,
    errorKey: global.auth.errorKey,
  }),
)(AuthBackupRestore));
