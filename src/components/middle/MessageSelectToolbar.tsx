import { memo, useEffect, useState } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiChat } from '../../api/types';
import type { MessageListType } from '../../types';
import type { IconName } from '../../types/icons';

import {
  selectCanDeleteSelectedMessages,
  selectCanDownloadSelectedMessages,
  selectCanForwardMessages,
  selectCurrentChat,
  selectCurrentMessageList, selectHasIpRevealingMedia,
  selectHasProtectedMessage,
  selectSelectedMessagesCount,
  selectTabState,
} from '../../global/selectors';
import { selectSharedSettings } from '../../global/selectors/sharedState';
import buildClassName from '../../util/buildClassName';
import captureKeyboardListeners from '../../util/captureKeyboardListeners';

import useFlag from '../../hooks/useFlag';
import useFrozenProps from '../../hooks/useFrozenProps';
import useKeyboardShortcutHint from '../../hooks/useKeyboardShortcutHint';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import usePreviousDeprecated from '../../hooks/usePreviousDeprecated';
import useCopySelectedMessages from './hooks/useCopySelectedMessages';

import Icon from '../common/icons/Icon';
import Checkbox from '../ui/Checkbox';
import ConfirmDialog from '../ui/ConfirmDialog';

import './MessageSelectToolbar.scss';

export type OwnProps = {
  isActive?: boolean;
  canPost?: boolean;
  messageListType?: MessageListType;
};

type StateProps = {
  chat?: ApiChat;
  isSchedule: boolean;
  selectedMessagesCount?: number;
  canDeleteMessages?: boolean;
  canDownloadMessages?: boolean;
  canForwardMessages?: boolean;
  hasProtectedMessage?: boolean;
  isAnyModalOpen?: boolean;
  selectedMessageIds?: number[];
  shouldWarnAboutFiles?: boolean;
  hasIpRevealingMedia?: boolean;
};

const MessageSelectToolbar = ({
  chat,
  canPost,
  isActive,
  messageListType,
  isSchedule,
  selectedMessagesCount,
  canDeleteMessages,
  canDownloadMessages,
  canForwardMessages,
  hasProtectedMessage,
  isAnyModalOpen,
  selectedMessageIds,
  shouldWarnAboutFiles,
  hasIpRevealingMedia,
}: OwnProps & StateProps) => {
  const {
    exitMessageSelectMode,
    openForwardMenuForSelectedMessages,
    downloadSelectedMessages,
    copySelectedMessages,
    openDeleteMessageModal,
    setSharedSettingOption,
  } = getActions();
  const lang = useLang();
  const deleteLabel = useKeyboardShortcutHint(lang('EditAdminGroupDeleteMessages'), 'deleteSelectedMessages');
  const copyLabel = useKeyboardShortcutHint(lang('ContextCopySelectedItems'), 'copySelectedMessages');

  useCopySelectedMessages(Boolean(isActive));

  const [isFileIpDialogOpen, openFileIpDialog, closeFileIpDialog] = useFlag();
  const [shouldNotWarnAboutFiles, setShouldNotWarnAboutFiles] = useState(false);

  const handleExitMessageSelectMode = useLastCallback(() => {
    exitMessageSelectMode();
  });

  const handleDelete = useLastCallback(() => {
    if (!selectedMessageIds || !chat) return;
    openDeleteMessageModal({
      chatId: chat.id,
      messageIds: selectedMessageIds,
      isSchedule,
    });
  });

  useEffect(() => {
    return isActive && !isAnyModalOpen
      ? captureKeyboardListeners({
        onBackspace: canDeleteMessages ? handleDelete : undefined,
        onDelete: canDeleteMessages ? handleDelete : undefined,
        onEsc: handleExitMessageSelectMode,
      })
      : undefined;
  }, [
    isActive, handleDelete, handleExitMessageSelectMode, isAnyModalOpen,
    canDeleteMessages,
  ]);

  const handleCopy = useLastCallback(() => {
    copySelectedMessages({ shouldNotify: true });
    exitMessageSelectMode();
  });

  const handleDownload = useLastCallback(() => {
    downloadSelectedMessages();
    exitMessageSelectMode();
  });

  const handleMessageDownload = useLastCallback(() => {
    if (shouldWarnAboutFiles && hasIpRevealingMedia) {
      openFileIpDialog();
      return;
    }

    handleDownload();
  });

  const handleFileIpConfirm = useLastCallback(() => {
    setSharedSettingOption({ shouldWarnAboutFiles: !shouldNotWarnAboutFiles });
    closeFileIpDialog();
    handleDownload();
  });

  const prevSelectedMessagesCount = usePreviousDeprecated(selectedMessagesCount || undefined, true);
  const renderingSelectedMessagesCount = isActive ? selectedMessagesCount : prevSelectedMessagesCount;

  const formattedMessagesCount = lang('VoiceOverChatMessagesSelected', {
    count: renderingSelectedMessagesCount || 0,
  }, { pluralValue: renderingSelectedMessagesCount || 0 });

  const rendering = useFrozenProps({
    selectedMessagesCount,
    canDeleteMessages,
    canDownloadMessages,
    canForwardMessages,
    hasProtectedMessage,
    messageListType,
  }, !isActive);

  const className = buildClassName(
    'MessageSelectToolbar',
    canPost && 'with-composer',
    isActive && 'shown',
  );

  const renderButton = (
    icon: IconName, label: string, onClick: AnyToVoidFunction, destructive?: boolean,
  ) => {
    return (
      <div
        role="button"
        tabIndex={0}
        className={buildClassName(
          'div-button',
          'item',
          destructive && 'destructive',
        )}
        onClick={onClick}
        title={label}
        aria-label={label}
      >
        <Icon name={icon} />
      </div>
    );
  };

  return (
    <>
      <div className={className}>
        <div className="MessageSelectToolbar-inner">
          {Boolean(rendering.selectedMessagesCount) && rendering.canDeleteMessages && (
            renderButton('delete', deleteLabel, handleDelete, true)
          )}
          <span className="MessageSelectToolbar-count" title={formattedMessagesCount}>
            {formattedMessagesCount}
          </span>

          {Boolean(rendering.selectedMessagesCount) && (
            <div className="MessageSelectToolbar-actions">
              {rendering.canDownloadMessages && !rendering.hasProtectedMessage && (
                renderButton('download', lang('AccActionDownload'), handleMessageDownload)
              )}
              {!rendering.hasProtectedMessage && (
                renderButton('copy', copyLabel, handleCopy)
              )}
              {rendering.messageListType !== 'scheduled' && rendering.canForwardMessages && (
                renderButton(
                  'forward', lang('ChatForwardActionHeader'), openForwardMenuForSelectedMessages,
                )
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={isFileIpDialogOpen}
        onClose={closeFileIpDialog}
        confirmHandler={handleFileIpConfirm}
      >
        {lang('LaunchSvgWarning')}
        <Checkbox
          className="dialog-checkbox"
          checked={shouldNotWarnAboutFiles}
          label={lang('LaunchExeDontAsk')}
          onCheck={setShouldNotWarnAboutFiles}
        />
      </ConfirmDialog>
    </>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const tabState = selectTabState(global);
    const { shouldWarnAboutFiles } = selectSharedSettings(global);
    const chat = selectCurrentChat(global);

    const { type: messageListType, chatId } = selectCurrentMessageList(global) || {};
    const isSchedule = messageListType === 'scheduled';
    const { canDelete } = selectCanDeleteSelectedMessages(global);
    const canDownload = selectCanDownloadSelectedMessages(global);
    const { messageIds: selectedMessageIds } = tabState.selectedMessages || {};
    const hasProtectedMessage = chatId ? selectHasProtectedMessage(global, chatId, selectedMessageIds) : false;
    const canForward = !isSchedule && chatId ? selectCanForwardMessages(global, chatId, selectedMessageIds) : false;
    const hasIpRevealingMedia = selectedMessageIds && chatId
      ? selectHasIpRevealingMedia(global, chatId, selectedMessageIds) : false;
    const isShareMessageModalOpen = tabState.isShareMessageModalShown;
    const isAnyModalOpen = Boolean(isShareMessageModalOpen || tabState.requestedDraft
      || tabState.deleteMessageModal);

    return {
      chat,
      isSchedule,
      selectedMessagesCount: selectSelectedMessagesCount(global),
      canDeleteMessages: canDelete,
      canDownloadMessages: canDownload,
      canForwardMessages: canForward,
      selectedMessageIds,
      hasProtectedMessage,
      isAnyModalOpen,
      shouldWarnAboutFiles,
      hasIpRevealingMedia,
    };
  },
)(MessageSelectToolbar));
