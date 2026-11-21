import { memo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiPeer } from '../../../api/types';
import type { TabState } from '../../../global/types';

import { getPeerTitle } from '../../../global/helpers/peers';
import { getMainUsername } from '../../../global/helpers/users';
import { selectPeer } from '../../../global/selectors';
import { copyTextToClipboard } from '../../../util/clipboard';
import formatUsername from '../../common/helpers/formatUsername';

import useCurrentOrPrev from '../../../hooks/useCurrentOrPrev';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import SignalQrCode from '../../common/SignalQrCode';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';

import styles from './QrCodeModal.module.scss';

export type OwnProps = {
  modal: TabState['qrCodeModal'];
};

type StateProps = {
  peer?: ApiPeer;
  username?: string;
};

const QR_SIZE = 200;

const QrCodeModal = ({ modal, peer, username }: OwnProps & StateProps) => {
  const { closeQrCodeModal, showNotification } = getActions();

  const lang = useLang();

  const renderingPeer = useCurrentOrPrev(peer);
  const renderingUsername = useCurrentOrPrev(username);
  const link = renderingUsername ? formatUsername(renderingUsername, true) : undefined;
  const isOpen = Boolean(modal) && Boolean(peer) && Boolean(username);

  const handleClose = useLastCallback(() => {
    closeQrCodeModal();
  });

  const handleCopyLink = useLastCallback(() => {
    copyTextToClipboard(link!);
    showNotification({ message: { key: 'LinkCopied' } });
  });

  return (
    <Modal
      isOpen={isOpen}
      title={lang('QrCodeTitle')}
      hasCloseButton
      isSlim
      contentClassName={styles.content}
      onClose={handleClose}
    >
      {link && (
        <div className={styles.card}>
          <SignalQrCode data={link} size={QR_SIZE} />
          <div className={styles.username}>{formatUsername(renderingUsername!)}</div>
          {renderingPeer && <div className={styles.title}>{getPeerTitle(lang, renderingPeer)}</div>}
        </div>
      )}
      <Button onClick={handleCopyLink} noForcedUpperCase>{lang('CopyLink')}</Button>
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { modal }): Complete<StateProps> => {
    const peer = modal?.peerId ? selectPeer(global, modal.peerId) : undefined;

    return {
      peer,
      username: peer ? getMainUsername(peer) : undefined,
    };
  },
)(QrCodeModal));
