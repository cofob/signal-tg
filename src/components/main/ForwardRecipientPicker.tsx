import {
  memo, useCallback, useEffect, useMemo, useState,
} from '../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../global';

import type { ForwardTarget, ThreadId } from '../../types';
import type { ChatSelectionKey } from '../../util/keys/chatSelectionKey';

import { getChatTitle, getUserFirstOrLastName } from '../../global/helpers';
import {
  selectCanCopyMessageLink,
  selectChat,
  selectChatMessages,
  selectTabState,
  selectUser,
} from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import captureKeyboardListeners from '../../util/captureKeyboardListeners';
import { isUserId } from '../../util/entities/ids';

import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import usePreviousDeprecated from '../../hooks/usePreviousDeprecated';

import RecipientPicker from '../common/RecipientPicker';
import Button from '../ui/Button';
import Transition from '../ui/Transition';

import styles from './ForwardRecipientPicker.module.scss';

export type OwnProps = {
  isOpen: boolean;
};

interface StateProps {
  currentUserId?: string;
  isStory?: boolean;
  isAudioTrack?: boolean;
  isForwarding?: boolean;
  fromChatId?: string;
  forwardMessageIds?: number[];
}

const ForwardRecipientPicker = ({
  isOpen,
  currentUserId,
  isStory,
  isAudioTrack,
  isForwarding,
  fromChatId,
  forwardMessageIds,
}: OwnProps & StateProps) => {
  const {
    openChatOrTopicWithReplyInDraft,
    setForwardChatOrTopic,
    exitForwardMode,
    forwardToSavedMessages,
    forwardToMultipleChats,
    forwardStory,
    forwardAudio,
    showNotification,
    copyMessageLink,
  } = getActions();

  const lang = useLang();

  const renderingIsStory = usePreviousDeprecated(isStory, true);
  const [isShown, markIsShown, unmarkIsShown] = useFlag();
  const [selectedIds, setSelectedIds] = useState<ChatSelectionKey[]>([]);
  const [caption, setCaption] = useState('');

  const isMultiSelect = isForwarding && !isStory && !isAudioTrack;
  const messageCount = forwardMessageIds?.length || 0;

  const canCopyLink = useMemo(() => {
    if (!fromChatId || forwardMessageIds?.length !== 1) return false;

    const global = getGlobal();
    const chatMessages = selectChatMessages(global, fromChatId);
    if (!chatMessages) return false;

    const message = chatMessages[forwardMessageIds[0]];
    return message && selectCanCopyMessageLink(global, message);
  }, [fromChatId, forwardMessageIds]);

  useEffect(() => {
    if (isOpen) {
      markIsShown();
    }
  }, [isOpen, markIsShown]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedIds([]);
      setCaption('');
    }
  }, [isOpen]);

  const forwardToSelf = useLastCallback(() => {
    forwardToSavedMessages({});
    showNotification({
      message: {
        key: 'FwdMessagesToNoteToSelf',
        options: {
          withNodes: true,
          withMarkdown: true,
          pluralValue: messageCount,
        },
      },
    });
  });

  const handleSelectRecipient = useCallback((recipientId: string, threadId?: ThreadId) => {
    const isSelf = recipientId === currentUserId;
    if (isAudioTrack) {
      forwardAudio({ toChatId: recipientId, toThreadId: threadId });
      return;
    }

    if (isStory) {
      forwardStory({ toChatId: recipientId });
      const global = getGlobal();
      if (isUserId(recipientId)) {
        showNotification({
          message: isSelf
            ? {
              key: 'ConversationStoryForwardTooltipSavedMessagesOne',
              options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
            }
            : {
              key: 'StorySharedTo',
              variables: { user: getUserFirstOrLastName(lang, selectUser(global, recipientId)) },
              options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
            },
        });
      } else {
        const chat = selectChat(global, recipientId);
        if (!chat) return;

        showNotification({
          message: {
            key: 'StorySharedTo',
            variables: { user: getChatTitle(lang, chat) },
            options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
          },
        });
      }
      return;
    }

    if (isSelf) {
      forwardToSelf();
    } else {
      const chatId = recipientId;
      const topicId = threadId ? Number(threadId) : undefined;
      if (isForwarding) {
        setForwardChatOrTopic({ chatId, topicId });
      } else {
        openChatOrTopicWithReplyInDraft({ chatId, topicId });
      }
    }
  }, [currentUserId, isStory, isAudioTrack, lang, isForwarding]);

  const handleClose = useCallback(() => {
    exitForwardMode();
  }, [exitForwardMode]);

  const handleSelectedIdsChange = useLastCallback((ids: ChatSelectionKey[]) => {
    setSelectedIds(ids);
  });

  const handleCopyLink = useLastCallback(() => {
    if (!fromChatId || !forwardMessageIds?.length) return;
    copyMessageLink({
      chatId: fromChatId,
      messageId: forwardMessageIds[0],
    });
    exitForwardMode();
  });

  const handleForwardToMultiple = useLastCallback(() => {
    if (!selectedIds.length) return;

    if (selectedIds.length === 1) {
      const { peerId: chatId, topicId } = selectedIds[0];
      if (chatId === currentUserId) {
        forwardToSelf();
        return;
      }

      setForwardChatOrTopic({ chatId, topicId });
      return;
    }

    executeForward();
  });

  const handleEnterShortcut = useLastCallback((e: KeyboardEvent) => {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
      return false;
    }

    if (!selectedIds.length) {
      if (!canCopyLink) return false;

      e.preventDefault();
      handleCopyLink();
      return undefined;
    }

    e.preventDefault();
    handleForwardToMultiple();
    return undefined;
  });

  useEffect(() => {
    if (!isOpen || !isMultiSelect) {
      return undefined;
    }

    return captureKeyboardListeners({ onEnter: handleEnterShortcut });
  }, [isOpen, isMultiSelect, handleEnterShortcut]);

  const executeForward = useLastCallback(() => {
    const targets: ForwardTarget[] = selectedIds.map(({ peerId, topicId }) => ({
      chatId: peerId,
      topicId,
    }));
    forwardToMultipleChats({ targets, comment: caption || undefined });

    showNotification({
      message: {
        key: 'FwdMessagesToChats',
        variables: { count: selectedIds.length },
        options: {
          pluralValue: selectedIds.length,
          withNodes: true,
          withMarkdown: true,
          renderTextFilters: ['br', 'links'],
        },
      },
    });
    exitForwardMode();
  });

  const viewportFooter = useMemo(() => (
    <div className="picker-list-spacer" />
  ), []);

  const selectedCount = selectedIds.length;
  const showComposer = selectedCount >= 2;

  const footerContent = useMemo(() => {
    if (!isForwarding || isStory) return undefined;

    const renderButton = () => {
      const isInitial = selectedCount === 0;

      return (
        <Button
          className="picker-footer-button"
          color="primary"
          disabled={isInitial && !canCopyLink}
          onClick={isInitial ? handleCopyLink : handleForwardToMultiple}
        >
          <Transition name="fade" activeKey={isInitial ? 0 : 1} slideClassName={styles.buttonSlide}>
            <span>
              {isInitial
                ? (canCopyLink ? lang('CopyLink') : lang('SelectChats'))
                : lang('Forward')}
            </span>
          </Transition>
        </Button>
      );
    };

    const renderComposer = () => (
      <div className="picker-footer-input">
        <div className="picker-caption-wrapper">
          <input
            className="picker-caption-input"
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.currentTarget.value)}
            placeholder={lang('AttachmentCaptionPlaceholder')}
          />
          <Button
            className="picker-send-button"
            color="primary"
            onClick={handleForwardToMultiple}
            ariaLabel={lang('Forward')}
          >
            <i className="icon icon-new-send" />
          </Button>
        </div>
      </div>
    );

    return (
      <div className="picker-footer">
        <div className={buildClassName(styles.buttonLayer, !showComposer && styles.visible)}>
          {renderButton()}
        </div>
        <div className={buildClassName(styles.composerLayer, showComposer && styles.visible)}>
          {renderComposer()}
        </div>
      </div>
    );
  }, [isForwarding, isStory, selectedCount, showComposer, caption, canCopyLink, handleForwardToMultiple, handleCopyLink,
    lang]);

  if (!isOpen && !isShown) {
    return undefined;
  }

  return (
    <RecipientPicker
      isOpen={isOpen}
      className={renderingIsStory ? 'component-theme-dark' : undefined}
      title={lang('ShareWith')}
      searchPlaceholder={lang('Search')}
      isMultiSelect={isMultiSelect}
      footer={footerContent}
      viewportFooter={viewportFooter}
      onSelectRecipient={handleSelectRecipient}
      onSelectedIdsChange={handleSelectedIdsChange}
      onClose={handleClose}
      onCloseAnimationEnd={unmarkIsShown}
      isForwarding={isForwarding || isAudioTrack}
      isNativeDialog
      withFolders
    />
  );
};

export default memo(withGlobal<OwnProps>((global): Complete<StateProps> => {
  const {
    messageIds, storyId, audioItem, fromChatId,
  } = selectTabState(global).forwardMessages;
  const isForwarding = (messageIds && messageIds.length > 0);

  return {
    currentUserId: global.currentUserId,
    isStory: Boolean(storyId),
    isAudioTrack: Boolean(audioItem),
    isForwarding,
    fromChatId,
    forwardMessageIds: messageIds,
  };
})(ForwardRecipientPicker));
