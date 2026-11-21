import { memo } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiChat, ApiUser } from '../../api/types';
import type { RegularLangKey } from '../../types/language';

import {
  getChatTitle,
  getUserFirstOrLastName,
  isChatBasicGroup,
} from '../../global/helpers';
import { selectIsChatWithSelf, selectUser } from '../../global/selectors';
import { isUserId } from '../../util/entities/ids';
import renderText from './helpers/renderText';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Avatar from './Avatar';

import './DeleteChatModal.scss';

export type OwnProps = {
  isOpen: boolean;
  chat: ApiChat;
  onClose: () => void;
  onCloseAnimationEnd?: () => void;
};

type StateProps = {
  isChatWithSelf?: boolean;
  isPrivateChat: boolean;
  isBasicGroup: boolean;
  canDeleteForAll?: boolean;
  contactUser?: ApiUser;
};

const DeleteChatModal = ({
  isOpen,
  chat,
  isPrivateChat,
  isChatWithSelf,
  isBasicGroup,
  canDeleteForAll,
  contactUser,
  onClose,
  onCloseAnimationEnd,
}: OwnProps & StateProps) => {
  const {
    leaveBasicGroup,
    deleteHistory,
    deleteChat,
  } = getActions();

  const lang = useLang();
  const contactName = getUserFirstOrLastName(lang, contactUser);
  const chatTitle = getChatTitle(lang, chat);

  const handleDeleteForAll = useLastCallback(() => {
    deleteHistory({ chatId: chat.id, shouldDeleteForAll: true });

    onClose();
  });

  const handleDeleteChat = useLastCallback(() => {
    if (isPrivateChat) {
      deleteHistory({ chatId: chat.id, shouldDeleteForAll: false });
    } else if (isBasicGroup) {
      if (chat.isOwner) {
        deleteHistory({ chatId: chat.id, shouldDeleteForAll: true });
        deleteChat({ chatId: chat.id });
      } else {
        // The history goes after leaving succeeded: a Signal group may refuse, as the last admin's does
        leaveBasicGroup({ chatId: chat.id });
      }
    }
    onClose();
  });

  const handleLeaveChat = useLastCallback(() => {
    if (isBasicGroup && chat.isOwner) {
      leaveBasicGroup({ chatId: chat.id });
      onClose();
    } else {
      handleDeleteChat();
    }
  });

  function renderHeader() {
    return (
      <div className="modal-header" dir={lang.isRtl ? 'rtl' : undefined}>
        <Avatar
          size="tiny"
          peer={chat}
          isSavedMessages={isChatWithSelf}
        />
        <h3 className="modal-title">{lang(renderTitle())}</h3>
      </div>
    );
  }

  function renderTitle(): RegularLangKey {
    if (isBasicGroup) {
      return 'GroupLeaveGroup';
    }

    return 'DeleteChat';
  }

  function renderContent() {
    if (isBasicGroup) {
      return <p>{renderText(lang('ChannelLeaveAlertWithName', { chat: chatTitle }), ['simple_markdown', 'emoji'])}</p>;
    }

    return (
      <p>{renderText(lang('ChatListDeleteChatConfirmation', { chat: contactName }), ['simple_markdown', 'emoji'])}</p>
    );
  }

  function renderActionText(): RegularLangKey {
    if (isBasicGroup) {
      return 'GroupLeaveGroup';
    }

    return canDeleteForAll ? 'ChatListDeleteForCurrentUser' : 'Delete';
  }

  return (
    <Modal
      isOpen={isOpen}
      className="DeleteChatModal"
      header={renderHeader()}
      onClose={onClose}
      onCloseAnimationEnd={onCloseAnimationEnd}
    >
      {renderContent()}
      <div className="dialog-buttons-column">
        {canDeleteForAll && (
          <Button color="danger" className="confirm-dialog-button" isText onClick={handleDeleteForAll}>
            {contactName ? renderText(lang('ChatListDeleteForEveryone', { user: contactName })) : lang('DeleteForAll')}
          </Button>
        )}
        {!isPrivateChat && chat.isOwner && (
          <Button color="danger" className="confirm-dialog-button" isText onClick={handleDeleteChat}>
            {lang('DeleteForAll')}
          </Button>
        )}
        <Button
          color="danger"
          className="confirm-dialog-button"
          isText
          onClick={isPrivateChat ? handleDeleteChat : handleLeaveChat}
        >
          {lang(renderActionText())}
        </Button>
        <Button className="confirm-dialog-button" isText onClick={onClose}>{lang('Cancel')}</Button>
      </div>
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chat }): Complete<StateProps> => {
    const isPrivateChat = isUserId(chat.id);
    const isChatWithSelf = selectIsChatWithSelf(global, chat.id);
    const user = selectUser(global, chat.id);
    const canDeleteForAll = isPrivateChat && !isChatWithSelf;
    const contactUser = isPrivateChat ? user : undefined;

    return {
      isPrivateChat,
      isChatWithSelf,
      isBasicGroup: isChatBasicGroup(chat),
      canDeleteForAll,
      contactUser,
    };
  },
)(DeleteChatModal));
