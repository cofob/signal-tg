import { memo, useState } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiUser } from '../../api/types';

import {
  getUserFirstOrLastName,
  isChatBasicGroup,
} from '../../global/helpers';
import { selectChat, selectIsChatWithSelf, selectUser } from '../../global/selectors';
import { isUserId } from '../../util/entities/ids';
import renderText from './helpers/renderText';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Modal from '../ui/Modal';

export type OwnProps = {
  isOpen: boolean;
  chatId: string;
  messageId: number;
  onClose: () => void;
};

type StateProps = {
  isPrivateChat: boolean;
  isChatWithSelf: boolean;
  isGroup: boolean;
  canPinForAll: boolean;
  contactUser?: ApiUser;
};

const PinMessageModal = ({
  isOpen,
  chatId,
  messageId,
  isGroup,
  canPinForAll,
  contactUser,
  onClose,
}: OwnProps & StateProps) => {
  const { pinMessage } = getActions();

  const [shouldPinForAll, setShouldPinForAll] = useState(true);

  const handlePinMessage = useLastCallback(() => {
    pinMessage({
      chatId,
      messageId,
      isUnpin: false,
      isOneSide: !shouldPinForAll,
      isSilent: !shouldPinForAll,
    });
    onClose();
  });

  const lang = useLang();
  const contactName = getUserFirstOrLastName(lang, contactUser);

  function renderMessage() {
    if (isGroup) {
      return lang('PinMessageAlert');
    }

    return lang('PinMessageAlertChat');
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="pin"
      title={lang('PinMessageAlertTitle')}
    >
      <p>{renderMessage()}</p>
      {canPinForAll && (
        <Checkbox
          className="dialog-checkbox"
          label={contactName ? renderText(lang('ConversationPinMessagesFor', { user: contactName }))
            : lang('ConversationPinMessageAlertPinAndNotifyMembers')}
          checked={shouldPinForAll}
          onCheck={setShouldPinForAll}
        />
      )}
      <div className="dialog-buttons">
        <Button className="confirm-dialog-button" isText onClick={handlePinMessage}>
          {lang('DialogPin')}
        </Button>
        <Button className="confirm-dialog-button" isText onClick={onClose}>{lang('Cancel')}</Button>
      </div>
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const isPrivateChat = isUserId(chatId);
    const isChatWithSelf = selectIsChatWithSelf(global, chatId);
    const chat = selectChat(global, chatId);
    const isGroup = Boolean(chat) && isChatBasicGroup(chat);
    const canPinForAll = (isPrivateChat && !isChatWithSelf) || isGroup;
    const contactUser = chatId && isUserId(chatId)
      ? selectUser(global, chatId)
      : undefined;

    return {
      isPrivateChat,
      isChatWithSelf,
      isGroup,
      canPinForAll,
      contactUser,
    };
  },
)(PinMessageModal));
