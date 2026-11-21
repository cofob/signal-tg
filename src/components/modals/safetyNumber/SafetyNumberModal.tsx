import { memo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiUser } from '../../../api/types';
import type { TabState } from '../../../global/types';

import { getPeerTitle } from '../../../global/helpers/peers';
import { selectUser } from '../../../global/selectors';

import useCurrentOrPrev from '../../../hooks/useCurrentOrPrev';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Icon from '../../common/icons/Icon';
import SignalQrCode from '../../common/SignalQrCode';
import Button from '../../ui/Button';
import Loading from '../../ui/Loading';
import Modal from '../../ui/Modal';

import styles from './SafetyNumberModal.module.scss';

export type OwnProps = {
  modal: TabState['safetyNumberModal'];
};

type StateProps = {
  user?: ApiUser;
};

const QR_SIZE = 160;
// Signal shows the 60 digits in groups of five
const BLOCK_SIZE = 5;
const BLOCK_PATTERN = new RegExp(`.{1,${BLOCK_SIZE}}`, 'g');

/**
 * The safety number with a contact and its QR code, which their phone can scan (Signal Desktop
 * `SafetyNumberViewer`). Marking it as verified syncs to our other devices.
 */
const SafetyNumberModal = ({
  modal,
  user,
}: OwnProps & StateProps) => {
  const { closeSafetyNumberModal, toggleSafetyNumberVerified } = getActions();

  const lang = useLang();

  const isOpen = Boolean(modal);
  const renderingModal = useCurrentOrPrev(modal);
  const renderingUser = useCurrentOrPrev(user);
  const name = renderingUser ? getPeerTitle(lang, renderingUser) : '';

  const handleClose = useLastCallback(() => {
    closeSafetyNumberModal();
  });

  const handleToggleVerified = useLastCallback(() => {
    toggleSafetyNumberVerified();
  });

  function renderContent() {
    if (renderingModal?.isUnavailable) {
      return <p className={styles.text}>{lang('SafetyNumberUnavailable', { user: name })}</p>;
    }
    if (!renderingModal?.digits) return <Loading />;

    const { digits, qrData, isVerified } = renderingModal;
    return (
      <>
        <div className={styles.card}>
          {qrData && <SignalQrCode data={qrData} size={QR_SIZE} isBinary />}
          <div className={styles.digits}>
            {digits.match(BLOCK_PATTERN)!.map((block, index) => (
              <span key={index} className={styles.block}>{block}</span>
            ))}
          </div>
          {isVerified && (
            <div className={styles.verified}>
              <Icon name="check" />
              {lang('SafetyNumberVerified')}
            </div>
          )}
        </div>
        <p className={styles.text}>{lang('SafetyNumberHint', { user: name })}</p>
        <Button onClick={handleToggleVerified} noForcedUpperCase>
          {lang(isVerified ? 'SafetyNumberClearVerification' : 'SafetyNumberMarkVerified')}
        </Button>
      </>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      title={lang('SafetyNumber')}
      hasCloseButton
      isSlim
      contentClassName={styles.content}
      onClose={handleClose}
    >
      {renderContent()}
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { modal }): Complete<StateProps> => ({
    user: modal ? selectUser(global, modal.userId) : undefined,
  }),
)(SafetyNumberModal));
