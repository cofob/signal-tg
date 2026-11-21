import { memo, useMemo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiUser } from '../../../api/types';
import type { GlobalState, TabState } from '../../../global/types';

import useCurrentOrPrev from '../../../hooks/useCurrentOrPrev';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import PrivateChatInfo from '../../common/PrivateChatInfo';
import Button from '../../ui/Button';
import ListItem from '../../ui/ListItem';
import Modal from '../../ui/Modal';

import styles from './SafetyNumberChangeModal.module.scss';

export type OwnProps = {
  modal: TabState['safetyNumberChangeModal'];
};

type StateProps = {
  usersById: GlobalState['users']['byId'];
};

/**
 * A message that was not sent because the safety numbers of its recipients changed (Signal Desktop
 * `SafetyNumberChangeDialog`): each recipient opens their safety number, and sending anyway accepts the new numbers
 * and sends the message to the recipients that did not get it.
 */
const SafetyNumberChangeModal = ({
  modal,
  usersById,
}: OwnProps & StateProps) => {
  const {
    closeSafetyNumberChangeModal, openSafetyNumberModal, sendMessageAnyway,
  } = getActions();

  const lang = useLang();

  const isOpen = Boolean(modal);
  const renderingModal = useCurrentOrPrev(modal);
  const users = useMemo(() => (
    renderingModal?.userIds.map((id) => usersById[id]).filter(Boolean) ?? []
  ), [renderingModal?.userIds, usersById]);

  const handleClose = useLastCallback(() => {
    closeSafetyNumberChangeModal();
  });

  const handleSendAnyway = useLastCallback(() => {
    sendMessageAnyway();
  });

  const handleVerify = useLastCallback((user: ApiUser) => {
    openSafetyNumberModal({ userId: user.id });
  });

  return (
    <Modal
      isOpen={isOpen}
      title={lang('SafetyNumberChanges')}
      hasCloseButton
      isSlim
      contentClassName={styles.content}
      onClose={handleClose}
    >
      <p className={styles.text}>{lang('SafetyNumberChangesText')}</p>
      <div className={styles.users}>
        {users.map((user) => (
          <ListItem
            key={user.id}
            narrow
            className="chat-item-clickable"
            rightElement={<span className={styles.verify}>{lang('SafetyNumberVerify')}</span>}
            onClick={() => handleVerify(user)}
          >
            <PrivateChatInfo userId={user.id} avatarSize="small" noStatusOrTyping />
          </ListItem>
        ))}
      </div>
      <div className="dialog-buttons-column">
        <Button className="confirm-dialog-button" isText onClick={handleSendAnyway}>
          {lang('SendAnyway')}
        </Button>
        <Button className="confirm-dialog-button" isText onClick={handleClose}>
          {lang('Cancel')}
        </Button>
      </div>
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => ({
    usersById: global.users.byId,
  }),
)(SafetyNumberChangeModal));
