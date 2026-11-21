import { memo } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { TabState } from '../../../global/types';

import { copyTextToClipboard } from '../../../util/clipboard';

import useCurrentOrPrev from '../../../hooks/useCurrentOrPrev';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';
import Modal from '../../ui/Modal';

import styles from './RecoveryKeyModal.module.scss';

export type OwnProps = {
  modal: TabState['recoveryKeyModal'];
};

// Signal Android shows the 64 characters in groups of four
const BLOCK_SIZE = 4;
const BLOCK_PATTERN = new RegExp(`.{1,${BLOCK_SIZE}}`, 'g');

/**
 * The recovery key of the account (Signal Android `MessageBackupsKeyRecordScreen`): the account entropy pool, which
 * derives the keys of the storage service and of backups. A new account shows it until the user confirms.
 */
const RecoveryKeyModal = ({ modal }: OwnProps) => {
  const {
    closeRecoveryKeyModal, confirmRecoveryKeySaved, showNotification,
  } = getActions();

  const lang = useLang();

  const isOpen = Boolean(modal);
  const renderingModal = useCurrentOrPrev(modal);

  const handleClose = useLastCallback(() => {
    closeRecoveryKeyModal();
  });

  const handleConfirm = useLastCallback(() => {
    confirmRecoveryKeySaved();
    closeRecoveryKeyModal();
  });

  const handleCopy = useLastCallback(() => {
    if (!renderingModal) return;
    copyTextToClipboard(renderingModal.key);
    showNotification({ message: lang('RecoveryKeyCopied') });
  });

  return (
    <Modal
      isOpen={isOpen}
      title={lang(renderingModal?.isUnconfirmed ? 'RecoveryKeyRecord' : 'RecoveryKey')}
      hasCloseButton
      isSlim
      contentClassName={styles.content}
      onClose={handleClose}
    >
      <p className={styles.text}>{lang('RecoveryKeyText')}</p>
      <div className={styles.key} dir="ltr">
        {renderingModal?.key.match(BLOCK_PATTERN)?.map((block, index) => (
          <span key={index} className={styles.block}>{block}</span>
        ))}
      </div>
      <p className={styles.warning}>{lang('RecoveryKeyWarning')}</p>
      <Button onClick={handleCopy} noForcedUpperCase>
        {lang('RecoveryKeyCopy')}
      </Button>
      {renderingModal?.isUnconfirmed && (
        <Button isText onClick={handleConfirm} noForcedUpperCase>
          {lang('RecoveryKeySaved')}
        </Button>
      )}
    </Modal>
  );
};

export default memo(RecoveryKeyModal);
