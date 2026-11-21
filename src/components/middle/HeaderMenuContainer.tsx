import {
  memo, useEffect, useMemo, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type {
  ApiChat,
} from '../../api/types';
import type { IAnchorPosition, ThreadId } from '../../types';
import { MAIN_THREAD_ID } from '../../api/types';

import { UNMUTE_TIMESTAMP } from '../../config';
import {
  getCanAddContact,
  getCanDeleteChat,
} from '../../global/helpers';
import { getIsChatMuted } from '../../global/helpers/notifications';
import {
  selectCanManage,
  selectCanManageAutoDelete,
  selectChat,
  selectChatHistoryTtl,
  selectIsChatRestricted,
  selectIsChatWithSelf,
  selectIsCurrentUserFrozen,
  selectIsRightColumnShown,
  selectNotifyDefaults,
  selectNotifyException,
  selectUser,
  selectUserFullInfo,
} from '../../global/selectors';
import { isUserId } from '../../util/entities/ids';
import { disableScrolling } from '../../util/scrollLock';
import { buildAutoDeletePeriodOptions, DEFAULT_AUTO_DELETE_PERIODS } from '../common/helpers/autoDeletePeriods';

import useAppLayout from '../../hooks/useAppLayout';
import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import useShowTransitionDeprecated from '../../hooks/useShowTransitionDeprecated';

import DeleteChatModal from '../common/DeleteChatModal';
import AutoDeleteOutlinedIcon from '../common/icons/AutoDeleteOutlinedIcon';
import MuteChatModal from '../left/MuteChatModal.async';
import Menu from '../ui/Menu';
import MenuItem from '../ui/MenuItem';
import MenuSeparator from '../ui/MenuSeparator';
import NestedMenuItem from '../ui/NestedMenuItem';
import Portal from '../ui/Portal';

import './HeaderMenuContainer.scss';

export type OwnProps = {
  chatId: string;
  threadId: ThreadId;
  isOpen: boolean;
  anchor: IAnchorPosition;
  canSearch?: boolean;
  canMute?: boolean;
  canLeave?: boolean;
  onSearchClick: () => void;
  onClose: () => void;
  onCloseAnimationEnd: () => void;
};

type StateProps = {
  chat?: ApiChat;
  isPrivate?: boolean;
  isMuted?: boolean;
  canAddContact?: boolean;
  canDeleteChat?: boolean;
  isRightColumnShown?: boolean;
  canManage?: boolean;
  isBlocked?: boolean;
  isChatWithSelf?: boolean;
  isAccountFrozen?: boolean;
  canManageAutoDelete?: boolean;
  historyTtl?: number;
};

const HeaderMenuContainer = ({
  chatId,
  isOpen,
  anchor,
  canSearch,
  canMute,
  canLeave,
  chat,
  isPrivate,
  isMuted,
  canDeleteChat,
  canAddContact,
  canManage,
  isRightColumnShown,
  isBlocked,
  isChatWithSelf,
  isAccountFrozen,
  canManageAutoDelete,
  historyTtl,
  onSearchClick,
  onClose,
  onCloseAnimationEnd,
}: OwnProps & StateProps) => {
  const {
    updateChatMutedState,
    enterMessageSelectMode,
    openAddContactDialog,
    openFrozenAccountModal,
    toggleManagement,
    blockUser,
    unblockUser,
    setChatHistoryTtl,
    openAutoDeleteTimerModal,
  } = getActions();

  const lang = useLang();

  const { isMobile } = useAppLayout();
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [shouldCloseFast, setShouldCloseFast] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isMuteModalOpen, setIsMuteModalOpen] = useState(false);
  const [shouldRenderMuteModal, markRenderMuteModal, unmarkRenderMuteModal] = useFlag();
  const { x, y } = anchor;

  useShowTransitionDeprecated(isOpen, onCloseAnimationEnd, undefined, false);

  const closeMuteModal = useLastCallback(() => {
    setIsMuteModalOpen(false);
    onClose();
  });

  const handleDelete = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      onClose();
    } else {
      setIsDeleteModalOpen(true);
    }
    setIsMenuOpen(false);
  });

  const closeMenu = useLastCallback(() => {
    setIsMenuOpen(false);
    onClose();
  });

  const closeDeleteModal = useLastCallback(() => {
    setIsDeleteModalOpen(false);
    onClose();
  });

  const handleUnmuteClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      updateChatMutedState({ chatId, mutedUntil: UNMUTE_TIMESTAMP });
    }
    closeMenu();
  });

  const handleMuteClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      closeMenu();
    } else {
      markRenderMuteModal();
      setIsMuteModalOpen(true);
    }
    setIsMenuOpen(false);
  });

  const handleEditClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      toggleManagement({ force: true });
      setShouldCloseFast(!isRightColumnShown);
    }
    closeMenu();
  });

  const handleAddContactClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openAddContactDialog({ userId: chatId });
    }
    closeMenu();
  });

  const handleSearch = useLastCallback(() => {
    onSearchClick();
    closeMenu();
  });

  const handleSelectMessages = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      enterMessageSelectMode();
    }
    closeMenu();
  });

  const handleBlock = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      blockUser({ userId: chatId });
    }
    closeMenu();
  });

  const handleUnblock = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      unblockUser({ userId: chatId });
    }
    closeMenu();
  });

  const handleAutoDeletePeriodSelect = useLastCallback((e: React.SyntheticEvent, period?: number) => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else if (period !== (historyTtl ?? 0)) {
      setChatHistoryTtl({ chatId, period: period! });
    }
    closeMenu();
  });

  const handleSetCustomAutoDeleteTime = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openAutoDeleteTimerModal({ chatId });
    }
    closeMenu();
  });

  useEffect(disableScrolling, []);

  const autoDeleteOptions = useMemo(() => {
    if (!canManageAutoDelete) return undefined;

    return buildAutoDeletePeriodOptions(lang, DEFAULT_AUTO_DELETE_PERIODS, historyTtl, lang('AutoDeleteNever'));
  }, [canManageAutoDelete, historyTtl, lang]);

  const deleteTitle = useMemo(() => {
    if (!chat) return undefined;

    if (isPrivate) {
      return lang('DeleteChat');
    }

    if (canDeleteChat) {
      return lang('GroupInfoDeleteAndExit');
    }

    return lang('GroupLeaveGroup');
  }, [canDeleteChat, chat, isPrivate, lang]);

  return (
    <Portal>
      <div className="HeaderMenuContainer">
        <Menu
          isOpen={isMenuOpen}
          positionX="right"
          style={`left: ${x}px;top: ${y}px;`}
          onClose={closeMenu}
          shouldCloseFast={shouldCloseFast}
        >
          {isMobile && canSearch && (
            <MenuItem
              icon="search"
              onClick={handleSearch}
            >
              {lang('Search')}
            </MenuItem>
          )}
          {canManage && (
            <MenuItem
              icon="edit"
              onClick={handleEditClick}
            >
              {lang('Edit')}
            </MenuItem>
          )}
          {canAddContact && (
            <MenuItem
              icon="add-user"
              onClick={handleAddContactClick}
            >
              {lang('AddContact')}
            </MenuItem>
          )}
          {canMute && (isMuted ? (
            <MenuItem
              icon="unmute"
              onClick={handleUnmuteClick}
            >
              {lang('ChatsUnmute')}
            </MenuItem>
          )
            : (
              <MenuItem
                icon="mute"
                onClick={handleMuteClick}
              >
                {lang('ChatsMute')}
                ...
              </MenuItem>
            )
          )}
          {autoDeleteOptions && (
            <NestedMenuItem
              customIcon={<AutoDeleteOutlinedIcon period={historyTtl ?? 0} />}
              submenu={(
                <>
                  {autoDeleteOptions.map(({ label, value }) => {
                    const period = Number(value);
                    return (
                      <MenuItem
                        key={value}
                        icon={period === (historyTtl ?? 0) ? 'check' : 'placeholder'}
                        clickArg={period}
                        onClick={handleAutoDeletePeriodSelect}
                      >
                        {label}
                      </MenuItem>
                    );
                  })}
                  <MenuItem
                    icon="tools"
                    onClick={handleSetCustomAutoDeleteTime}
                  >
                    {lang('SetCustomTime')}
                  </MenuItem>
                </>
              )}
            >
              {lang('AutoDeletePopupTitle')}
            </NestedMenuItem>
          )}
          <MenuItem
            icon="select"
            onClick={handleSelectMessages}
          >
            {lang('ReportSelectMessages')}
          </MenuItem>
          {isPrivate && !isChatWithSelf && (
            <MenuItem
              icon={isBlocked ? 'user' : 'hand-stop'}
              onClick={isBlocked ? handleUnblock : handleBlock}
            >
              {isBlocked ? lang('Unblock') : lang('NewContactBlock')}
            </MenuItem>
          )}
          {canLeave && (
            <>
              <MenuSeparator />
              <MenuItem
                destructive
                icon="delete"
                onClick={handleDelete}
              >
                {deleteTitle}
              </MenuItem>
            </>
          )}
        </Menu>
        {chat && (
          <DeleteChatModal
            isOpen={isDeleteModalOpen}
            onClose={closeDeleteModal}
            chat={chat}
          />
        )}
        {canMute && shouldRenderMuteModal && chat?.id && (
          <MuteChatModal
            isOpen={isMuteModalOpen}
            onClose={closeMuteModal}
            onCloseAnimationEnd={unmarkRenderMuteModal}
            chatId={chat.id}
          />
        )}
      </div>
    </Portal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId, threadId }): Complete<StateProps> => {
    const chat = selectChat(global, chatId);
    const isRestricted = selectIsChatRestricted(global, chatId);
    if (!chat || isRestricted) {
      return {} as Complete<StateProps>;
    }
    const isPrivate = isUserId(chat.id);
    const user = isPrivate ? selectUser(global, chatId) : undefined;
    const canAddContact = user && getCanAddContact(user);
    const isMainThread = threadId === MAIN_THREAD_ID;
    const isChatWithSelf = selectIsChatWithSelf(global, chatId);

    const userFullInfo = isPrivate ? selectUserFullInfo(global, chatId) : undefined;

    const canManage = selectCanManage(global, chatId);

    const isAccountFrozen = selectIsCurrentUserFrozen(global);
    const canManageAutoDelete = isMainThread && selectCanManageAutoDelete(global, chatId);

    return {
      chat,
      isMuted: getIsChatMuted(chat, selectNotifyDefaults(global), selectNotifyException(global, chat.id)),
      isPrivate,
      canAddContact,
      canDeleteChat: getCanDeleteChat(chat),
      canManage,
      isRightColumnShown: selectIsRightColumnShown(global),
      isBlocked: userFullInfo?.isBlocked,
      isChatWithSelf,
      isAccountFrozen,
      canManageAutoDelete,
      historyTtl: canManageAutoDelete ? selectChatHistoryTtl(global, chatId) : undefined,
    };
  },
)(HeaderMenuContainer));
