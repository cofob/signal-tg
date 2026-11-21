import { memo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiKeyTransparencyStatus, ApiUser } from '../../../api/types';
import type { TabState } from '../../../global/types';
import type { IconName } from '../../../types/icons';
import type { RegularLangKey } from '../../../types/language';

import { KEY_TRANSPARENCY_URL } from '../../../config';
import { getPeerTitle } from '../../../global/helpers/peers';
import { selectUser } from '../../../global/selectors';
import buildClassName from '../../../util/buildClassName';

import useCurrentOrPrev from '../../../hooks/useCurrentOrPrev';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Icon from '../../common/icons/Icon';
import SignalQrCode from '../../common/SignalQrCode';
import Button from '../../ui/Button';
import Link from '../../ui/Link';
import Loading from '../../ui/Loading';
import Modal from '../../ui/Modal';
import Spinner from '../../ui/Spinner';

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
const KEY_TRANSPARENCY_ICONS = {
  idle: 'key',
  ok: 'check-filled',
  fail: 'warning',
  error: 'info',
  unavailable: 'info',
} as const satisfies Partial<Record<ApiKeyTransparencyStatus, IconName>>;
const KEY_TRANSPARENCY_BUTTON_KEYS = {
  idle: 'KeyTransIdle',
  ok: 'KeyTransOk',
  fail: 'KeyTransFail',
  error: 'KeyTransError',
  unavailable: 'KeyTransUnavailable',
} as const satisfies Partial<Record<ApiKeyTransparencyStatus, RegularLangKey>>;

/**
 * The safety number with a contact and its QR code, which their phone can scan (Signal Desktop
 * `SafetyNumberViewer`). Marking it as verified syncs to our other devices. Below it, automatic key verification
 * (key transparency) checks the contact's identity key against Signal's log of keys when the screen opens.
 */
const SafetyNumberModal = ({
  modal,
  user,
}: OwnProps & StateProps) => {
  const {
    closeSafetyNumberModal, toggleSafetyNumberVerified, checkKeyTransparency, cancelKeyTransparencyCheck,
  } = getActions();

  const lang = useLang();

  const isOpen = Boolean(modal);
  const renderingModal = useCurrentOrPrev(modal);
  const renderingUser = useCurrentOrPrev(user);
  const name = renderingUser ? getPeerTitle(lang, renderingUser) : '';

  const handleClose = useLastCallback(() => {
    // The check stops at its next request, such as the one that waits out a rate limit
    cancelKeyTransparencyCheck();
    closeSafetyNumberModal();
  });

  const handleToggleVerified = useLastCallback(() => {
    toggleSafetyNumberVerified();
  });

  const handleKeyTransparencyClick = useLastCallback(() => {
    checkKeyTransparency();
  });

  function renderKeyTransparency(status: ApiKeyTransparencyStatus) {
    const isRunning = status === 'running';
    const icon = status === 'running' ? undefined : KEY_TRANSPARENCY_ICONS[status];
    const buttonText = status === 'running' ? lang('KeyTransRunning') : lang(KEY_TRANSPARENCY_BUTTON_KEYS[status]);
    const text = status === 'ok'
      ? lang('KeyTransOkText')
      : status === 'fail'
        ? lang('KeyTransFailText', { user: name })
        : status === 'error'
          ? lang('KeyTransErrorText')
          : status === 'unavailable' ? lang('KeyTransUnavailableText') : undefined;

    return (
      <div className={styles.keyTransparency}>
        <h3 className={styles.keyTransparencyTitle}>{lang('KeyTransTitle')}</h3>
        <Button
          className={buildClassName(
            styles.keyTransparencyButton,
            status === 'ok' && styles.isVerified,
            status === 'fail' && styles.isFailed,
          )}
          color="translucent"
          fluid
          disabled={isRunning}
          nonInteractive={status === 'unavailable'}
          noForcedUpperCase
          onClick={handleKeyTransparencyClick}
        >
          {icon ? <Icon name={icon} /> : <Spinner color="gray" />}
          {buttonText}
        </Button>
        {text && <p className={styles.text}>{text}</p>}
        <p className={styles.text}>
          {lang('KeyTransHint')}
          {' '}
          <Link isPrimary href={KEY_TRANSPARENCY_URL}>{lang('KeyTransLearnMore')}</Link>
        </p>
      </div>
    );
  }

  function renderContent() {
    if (renderingModal?.isUnavailable) {
      return <p className={styles.text}>{lang('SafetyNumberUnavailable', { user: name })}</p>;
    }
    if (!renderingModal?.digits) return <Loading />;

    const { digits, qrData, isVerified, keyTransparencyStatus } = renderingModal;
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
        {keyTransparencyStatus && renderKeyTransparency(keyTransparencyStatus)}
      </>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      className="tall"
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
