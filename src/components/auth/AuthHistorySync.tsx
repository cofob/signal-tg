import { memo } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type { ApiHistorySyncProgress } from '../../api/types';

import useLang from '../../hooks/useLang';

import Loading from '../ui/Loading';

import styles from './AuthHistorySync.module.scss';

type StateProps = {
  historySync?: ApiHistorySyncProgress;
};

const PERCENT = 100;

/** The link screen while the primary device transfers message history (Signal Desktop `InstallScreenBackupImportStep`) */
const AuthHistorySync = ({ historySync }: StateProps) => {
  const lang = useLang();

  const step = historySync?.step ?? 'waiting';
  const progress = historySync?.progress ?? 0;
  const percent = `${Math.round(progress * PERCENT)}%`;

  return (
    <div id="auth-qr-form" className="custom-scroll">
      <div className="auth-form qr">
        <div className={styles.status}>
          {step === 'waiting' ? <Loading /> : (
            <div className={styles.track}>
              <div className={styles.fill} style={`transform: scaleX(${progress})`} />
            </div>
          )}
        </div>
        <h1>{lang('SignalHistorySyncTitle')}</h1>
        <p className={styles.hint}>
          {step === 'waiting' && lang('SignalHistorySyncWaiting')}
          {step === 'downloading' && lang('SignalHistorySyncDownloading', { percent })}
          {step === 'importing' && lang('SignalHistorySyncImporting', { percent })}
        </p>
        <p className="note">{lang('SignalHistorySyncNote')}</p>
      </div>
    </div>
  );
};

export default memo(withGlobal(
  (global): Complete<StateProps> => ({
    historySync: global.auth.historySync,
  }),
)(AuthHistorySync));
