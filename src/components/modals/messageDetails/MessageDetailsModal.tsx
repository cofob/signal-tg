import { memo, useMemo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiMessage, ApiMessageRecipient } from '../../../api/types';
import type { TabState } from '../../../global/types';

import { getSendErrorKey, getSendingState } from '../../../global/helpers';
import { selectChatMessage } from '../../../global/selectors';
import buildClassName from '../../../util/buildClassName';

import useCurrentOrPrev from '../../../hooks/useCurrentOrPrev';
import useEffectWithPrevDeps from '../../../hooks/useEffectWithPrevDeps';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import PrivateChatInfo from '../../common/PrivateChatInfo';
import Button from '../../ui/Button';
import ListItem from '../../ui/ListItem';
import Modal from '../../ui/Modal';

import styles from './MessageDetailsModal.module.scss';

export type OwnProps = {
  modal: TabState['messageDetailsModal'];
};

type StateProps = {
  message?: ApiMessage;
};

type RecipientStatus = ApiMessageRecipient['status'];

// The order of Signal Desktop's message details (`VISIBLE_SEND_STATUS_ORDER`)
const STATUS_ORDER: RecipientStatus[] = ['failed', 'viewed', 'read', 'delivered', 'sent', 'pending'];
const STATUS_TITLE_KEYS = {
  failed: 'MessageDetailsNotSent',
  viewed: 'MessageDetailsViewed',
  read: 'MessageDetailsRead',
  delivered: 'MessageDetailsDelivered',
  sent: 'MessageDetailsSent',
  pending: 'MessageDetailsPending',
} as const satisfies Record<RecipientStatus, string>;

/**
 * How sending an outgoing message to each recipient went (Signal Desktop `MessageDetail`): the recipients grouped by
 * status, the reason of each failure, and sending the message again to those it failed for
 */
const MessageDetailsModal = ({
  modal,
  message,
}: OwnProps & StateProps) => {
  const {
    closeMessageDetailsModal, loadMessageDetails, resendMessage, openSafetyNumberModal,
  } = getActions();

  const lang = useLang();

  const isOpen = Boolean(modal);
  const renderingModal = useCurrentOrPrev(modal);
  const sendingState = message && getSendingState(message);
  const canResend = sendingState === 'failed' || sendingState === 'partial';

  const reload = useLastCallback(() => {
    if (modal) loadMessageDetails({ chatId: modal.chatId, messageId: modal.messageId });
  });

  // Statuses change as the message is sent again and as receipts arrive
  useEffectWithPrevDeps((prevDeps) => {
    if (prevDeps.length) reload();
  }, [sendingState, message?.isDelivered]);

  const recipientsByStatus = useMemo(() => {
    const byStatus = new Map<RecipientStatus, ApiMessageRecipient[]>();
    for (const recipient of renderingModal?.recipients ?? []) {
      byStatus.set(recipient.status, [...byStatus.get(recipient.status) ?? [], recipient]);
    }
    return byStatus;
  }, [renderingModal?.recipients]);

  const handleClose = useLastCallback(() => {
    closeMessageDetailsModal();
  });

  const handleResend = useLastCallback(() => {
    resendMessage({ chatId: modal!.chatId, messageId: modal!.messageId });
  });

  const handleShowSafetyNumber = useLastCallback((userId: string) => {
    openSafetyNumberModal({ userId });
  });

  function renderRecipient({ userId, error }: ApiMessageRecipient) {
    const isSafetyNumberChange = error === 'identityChanged';
    return (
      <ListItem
        key={userId}
        narrow
        className={buildClassName('chat-item-clickable', error && styles.reason)}
        rightElement={isSafetyNumberChange
          ? <span className={styles.verify}>{lang('SafetyNumberView')}</span>
          : undefined}
        onClick={isSafetyNumberChange ? () => handleShowSafetyNumber(userId) : undefined}
      >
        <PrivateChatInfo
          userId={userId}
          avatarSize="small"
          noStatusOrTyping={!error}
          status={error ? lang(getSendErrorKey(error)) : undefined}
        />
      </ListItem>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      title={lang('MessageDetails')}
      hasCloseButton
      isSlim
      contentClassName={styles.content}
      onClose={handleClose}
    >
      {sendingState === 'partial' && <p className={styles.notice}>{lang('MessageDetailsPartial')}</p>}
      {STATUS_ORDER.map((status) => {
        const recipients = recipientsByStatus.get(status);
        if (!recipients) return undefined;
        return (
          <div key={status} className={styles.group}>
            <h4 className={buildClassName(styles.groupTitle, status === 'failed' && styles.groupTitleFailed)}>
              {lang(STATUS_TITLE_KEYS[status])}
            </h4>
            {recipients.map(renderRecipient)}
          </div>
        );
      })}
      <div className="dialog-buttons-column">
        {canResend && (
          <Button className="confirm-dialog-button" isText onClick={handleResend}>
            {lang('MessageResend')}
          </Button>
        )}
        <Button className="confirm-dialog-button" isText onClick={handleClose}>
          {lang('Close')}
        </Button>
      </div>
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { modal }): Complete<StateProps> => ({
    message: modal ? selectChatMessage(global, modal.chatId, modal.messageId) : undefined,
  }),
)(MessageDetailsModal));
