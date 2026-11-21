import {
  memo,
  useEffect,
  useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiChat, ApiUser } from '../../api/types';

import { getUserFirstOrLastName, isChatBasicGroup } from '../../global/helpers';
import {
  selectCanDeleteSelectedMessages,
  selectChat,
  selectTabState,
  selectUser,
} from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import { isUserId } from '../../util/entities/ids';
import renderText from './helpers/renderText';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import usePreviousDeprecated from '../../hooks/usePreviousDeprecated';

import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Modal from '../ui/Modal';

import styles from './DeleteMessageModal.module.scss';

export type OwnProps = {
  isOpen?: boolean;
};

type StateProps = {
  chat?: ApiChat;
  messageIds?: number[];
  canDeleteForAll?: boolean;
  contactUser?: ApiUser;
  willDeleteForCurrentUserOnly?: boolean;
  isSchedule?: boolean;
  onConfirm?: NoneToVoidFunction;
};

const DeleteMessageModal = ({
  isOpen,
  chat,
  isSchedule,
  messageIds,
  canDeleteForAll,
  contactUser,
  willDeleteForCurrentUserOnly,
  onConfirm,
}: OwnProps & StateProps) => {
  const {
    closeDeleteMessageModal,
    deleteMessages,
    deleteScheduledMessages,
    exitMessageSelectMode,
  } = getActions();

  const prevIsOpen = usePreviousDeprecated(isOpen);

  const lang = useLang();
  const contactName = getUserFirstOrLastName(lang, contactUser);

  const [shouldDeleteForAll, setShouldDeleteForAll] = useState(true);

  const handleDeleteMessageList = useLastCallback(() => {
    if (!chat || !messageIds) return;

    onConfirm?.();
    if (isSchedule) {
      deleteScheduledMessages({ messageIds });
    } else {
      deleteMessages({ messageIds, shouldDeleteForAll });
    }

    closeDeleteMessageModal();
    exitMessageSelectMode();
  });

  const onCloseHandler = useLastCallback(() => {
    closeDeleteMessageModal();
  });

  useEffect(() => {
    if (!isOpen && prevIsOpen) {
      setShouldDeleteForAll(true);
    }
  }, [isOpen, prevIsOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCloseHandler}
      onEnter={handleDeleteMessageList}
      className={styles.root}
      isNativeDialog
    >
      <div className={styles.main}>
        <div dir={lang.isRtl ? 'rtl' : undefined}>
          <h3 className={styles.title}>
            {lang('ChatDeleteMessagesConfirmation', {
              count: messageIds?.length || 0,
            }, { pluralValue: messageIds?.length || 0 })}
          </h3>
        </div>
        <p>
          {messageIds && messageIds.length > 1
            ? lang('AreYouSureDeleteFewMessages') : lang('AreYouSureDeleteSingleMessage')}
        </p>
        {willDeleteForCurrentUserOnly && (
          <p>{lang('DeleteForMeChatHint', undefined, { pluralValue: 1 })}</p>
        )}
        {canDeleteForAll && (
          <Checkbox
            className="dialog-checkbox"
            label={contactName ? renderText(lang('DeleteMessagesOptionAlso', { user: contactName }))
              : lang('ConversationDeleteMessagesForEveryone')}
            checked={shouldDeleteForAll}
            onCheck={setShouldDeleteForAll}
          />
        )}
        <div className={buildClassName('dialog-buttons', styles.proceedButtons)}>
          <Button color="danger" className="confirm-dialog-button" isText onClick={handleDeleteMessageList}>
            {lang('Delete')}
          </Button>
          <Button className="confirm-dialog-button" isText onClick={onCloseHandler} autoFocus>
            {lang('Cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const {
      deleteMessageModal,
    } = selectTabState(global);
    const messageIds = deleteMessageModal?.messageIds;
    const chatId = deleteMessageModal?.chatId;
    const { canDeleteForAll } = selectCanDeleteSelectedMessages(global, messageIds);
    const chat = chatId ? selectChat(global, chatId) : undefined;
    const isSchedule = deleteMessageModal?.isSchedule;
    const onConfirm = deleteMessageModal?.onConfirm;
    const contactUser = chatId && isUserId(chatId)
      ? selectUser(global, chatId)
      : undefined;
    const willDeleteForCurrentUserOnly = chat && isChatBasicGroup(chat) && !canDeleteForAll;

    return {
      chat,
      messageIds,
      canDeleteForAll: !isSchedule && canDeleteForAll,
      contactUser,
      willDeleteForCurrentUserOnly,
      isSchedule,
      onConfirm,
    };
  },
)(DeleteMessageModal));
