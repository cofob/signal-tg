import { memo, useEffect } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiMessage } from '../../../api/types';
import type { MessageListType, ThreadId } from '../../../types';
import type { Signal } from '../../../util/signals';
import { MAIN_THREAD_ID } from '../../../api/types';

import { getMessageIsSpoiler } from '../../../global/helpers';
import {
  selectAllowedMessageActionsSlow,
  selectChatMessages,
  selectPinnedIds,
} from '../../../global/selectors';
import buildClassName from '../../../util/buildClassName';
import cycleRestrict from '../../../util/cycleRestrict';
import { REM } from '../../common/helpers/mediaDimensions';

import useDerivedState from '../../../hooks/useDerivedState';
import useEnsureMessage from '../../../hooks/useEnsureMessage';
import { useFastClick } from '../../../hooks/useFastClick';
import useFlag from '../../../hooks/useFlag';
import useFrozenProps from '../../../hooks/useFrozenProps';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import useAsyncRendering from '../../right/hooks/useAsyncRendering';
import useHeaderPane, { type PaneState } from '../hooks/useHeaderPane';

import AnimatedCounter from '../../common/AnimatedCounter';
import CompactMediaPreview, { canRenderCompactMediaPreview } from '../../common/CompactMediaPreview';
import Icon from '../../common/icons/Icon';
import MessageSummary from '../../common/MessageSummary';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import RippleEffect from '../../ui/RippleEffect';
import Spinner from '../../ui/Spinner';
import Transition from '../../ui/Transition';
import PinnedMessageNavigation from '../PinnedMessageNavigation';

import styles from './HeaderPinnedMessage.module.scss';

const MAX_LENGTH = 256;
const SHOW_LOADER_DELAY = 450;
const EMOJI_SIZE = 1.125 * REM;

type OwnProps = {
  chatId: string;
  threadId: ThreadId;

  messageListType: MessageListType;
  className?: string;
  shouldHide?: boolean;
  getLoadingPinnedId: Signal<number | undefined>;
  getCurrentPinnedIndex: Signal<number>;
  onFocusPinnedMessage: (messageId: number) => void;
  onPaneStateChange?: (state: PaneState) => void;
};

type StateProps = {
  pinnedMessageIds?: number[] | number;
  messagesById?: Record<number, ApiMessage>;
  canUnpin?: boolean;
  isSynced?: boolean;
};

const HeaderPinnedMessage = ({
  chatId,
  threadId,
  canUnpin,
  getLoadingPinnedId,
  pinnedMessageIds,
  messagesById,
  getCurrentPinnedIndex,
  className,
  isSynced,
  shouldHide,
  onPaneStateChange,
  onFocusPinnedMessage,
}: OwnProps & StateProps) => {
  const {
    focusMessage, openChat, pinMessage, loadPinnedMessages,
  } = getActions();
  const lang = useLang();

  const currentPinnedIndex = useDerivedState(getCurrentPinnedIndex);
  const pinnedMessageId = Array.isArray(pinnedMessageIds) ? pinnedMessageIds[currentPinnedIndex] : pinnedMessageIds;
  const pinnedMessage = messagesById && pinnedMessageId ? messagesById[pinnedMessageId] : undefined;
  const pinnedMessagesCount = Array.isArray(pinnedMessageIds)
    ? pinnedMessageIds.length : (pinnedMessageIds ? 1 : 0);
  const pinnedMessageNumber = Math.max(pinnedMessagesCount - currentPinnedIndex, 1);

  const isLoading = Boolean(useDerivedState(getLoadingPinnedId));
  const canRenderLoader = useAsyncRendering([isLoading], SHOW_LOADER_DELAY);
  const shouldShowLoader = canRenderLoader && isLoading;

  const isOpen = Boolean(pinnedMessage) && !shouldHide;

  const {
    chatId: renderingChatId,
    threadId: renderingThreadId,
    pinnedMessage: renderingPinnedMessage,
    pinnedMessageId: renderingPinnedMessageId,
    pinnedMessageIds: renderingPinnedMessageIds,
    pinnedMessagesCount: renderingPinnedMessagesCount,
    pinnedMessageNumber: renderingPinnedMessageNumber,
    currentPinnedIndex: renderingPinnedIndex,
    canUnpin: renderingCanUnpin,
  } = useFrozenProps({
    chatId,
    threadId,
    pinnedMessage,
    pinnedMessageId,
    pinnedMessageIds,
    pinnedMessagesCount,
    pinnedMessageNumber,
    currentPinnedIndex,
    canUnpin,
  }, !isOpen);
  const hasPictogram = Boolean(
    renderingPinnedMessage && canRenderCompactMediaPreview(renderingPinnedMessage.content),
  );
  const isSpoiler = renderingPinnedMessage && getMessageIsSpoiler(renderingPinnedMessage);

  useEffect(() => {
    if (isSynced && threadId === MAIN_THREAD_ID) {
      loadPinnedMessages({ chatId, threadId });
    }
  }, [chatId, threadId, isSynced]);

  useEnsureMessage(chatId, pinnedMessageId, pinnedMessage);

  const { ref, shouldRender } = useHeaderPane({
    isOpen,
    isPending: Boolean(pinnedMessageId) && !pinnedMessage && !shouldHide,
    measureKey: `${chatId}_${threadId}`,
    onStateChange: onPaneStateChange,
  });

  const [isUnpinDialogOpen, openUnpinDialog, closeUnpinDialog] = useFlag();

  useEffect(() => {
    closeUnpinDialog();
  }, [chatId, threadId, closeUnpinDialog]);

  const handleUnpinMessage = useLastCallback(() => {
    closeUnpinDialog();
    pinMessage({ chatId: renderingChatId, messageId: renderingPinnedMessage!.id, isUnpin: true });
  });

  const handleAllPinnedClick = useLastCallback(() => {
    openChat({ id: renderingChatId, type: 'pinned' });
  });

  const handleMessageClick = useLastCallback((e: React.MouseEvent<HTMLElement, MouseEvent>): void => {
    const nextMessageId = e.shiftKey && Array.isArray(renderingPinnedMessageIds)
      ? renderingPinnedMessageIds[cycleRestrict(
        renderingPinnedMessageIds.length, renderingPinnedMessageIds.indexOf(renderingPinnedMessageId!) - 2,
      )]
      : renderingPinnedMessageId!;

    if (!getLoadingPinnedId()) {
      focusMessage({
        chatId: renderingChatId, threadId: renderingThreadId, messageId: nextMessageId,
      });
      onFocusPinnedMessage(nextMessageId);
    }
  });

  const { handleClick, handleMouseDown } = useFastClick(handleMessageClick);

  if (!shouldRender || !renderingPinnedMessage) return undefined;

  return (
    <div
      ref={ref}
      className={buildClassName(
        'HeaderPinnedMessageWrapper', styles.root,
        className,
      )}
    >
      {(renderingPinnedMessagesCount > 1 || shouldShowLoader) && (
        <Button
          round
          size="smaller"
          color="translucent"
          ariaLabel={lang('EventLogFilterPinnedMessages')}
          onClick={!shouldShowLoader ? handleAllPinnedClick : undefined}
        >
          {isLoading && (
            <Spinner
              color="blue"
              className={buildClassName(
                styles.loading, styles.pinListIcon, !shouldShowLoader && styles.pinListIconHidden,
              )}
            />
          )}
          <Icon
            name="pin-list"
            className={buildClassName(
              styles.pinListIcon, shouldShowLoader && styles.pinListIconHidden,
            )}
          />
        </Button>
      )}
      {renderingCanUnpin && (
        <Button
          round
          size="smaller"
          color="translucent"
          ariaLabel={lang('UnpinMessageAlertTitle')}
          onClick={openUnpinDialog}
          iconName="close"
        />
      )}
      <ConfirmDialog
        isOpen={isUnpinDialogOpen}
        onClose={closeUnpinDialog}
        text={lang('PinnedConfirmUnpin')}
        confirmLabel={lang('DialogUnpin')}
        confirmHandler={handleUnpinMessage}
      />
      <div
        className={styles.pinnedMessage}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        dir={lang.isRtl ? 'rtl' : undefined}
      >
        <PinnedMessageNavigation
          count={renderingPinnedMessagesCount}
          index={renderingPinnedIndex}
        />
        <Transition activeKey={renderingPinnedMessage.id} name="slideVertical" className={styles.pictogramTransition}>
          <CompactMediaPreview
            media={renderingPinnedMessage.content}
            className={styles.pinnedThumb}
            isPictogram
            isSpoiler={isSpoiler}
          />
        </Transition>
        <div
          className={buildClassName(styles.messageText, hasPictogram && styles.withMedia)}
          dir={lang.isRtl ? 'rtl' : undefined}
        >
          <div className={styles.title} dir={lang.isRtl ? 'rtl' : undefined}>
            <AnimatedCounter
              text={renderingPinnedMessagesCount === 1
                ? lang('PinnedMessageTitleSingle')
                : lang('PinnedMessageTitle',
                  { index: renderingPinnedMessageNumber },
                  { pluralValue: renderingPinnedMessagesCount })}
            />
          </div>
          <Transition
            activeKey={renderingPinnedMessage.id}
            name="slideVerticalFade"
            className={styles.messageTextTransition}
          >
            <p dir="auto" className={styles.summary}>
              <MessageSummary
                message={renderingPinnedMessage}
                truncateLength={MAX_LENGTH}
                noEmoji={hasPictogram}
                emojiSize={EMOJI_SIZE}
              />
            </p>
          </Transition>
        </div>
        <RippleEffect />
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, {
    chatId, threadId, messageListType,
  }): Complete<StateProps> => {
    const isSynced = global.isSynced;

    const messagesById = selectChatMessages(global, chatId);

    const state = {
      isSynced,
    };

    if (messageListType !== 'thread' || !messagesById) {
      return state as Complete<StateProps>;
    }

    const pinnedMessageIds = selectPinnedIds(global, chatId, threadId);
    if (pinnedMessageIds?.length) {
      const firstPinnedMessage = messagesById[pinnedMessageIds[0]];
      const {
        canUnpin = false,
      } = (
        firstPinnedMessage
        && pinnedMessageIds.length === 1
        && selectAllowedMessageActionsSlow(global, firstPinnedMessage, threadId)
      ) || {};

      return {
        ...state,
        pinnedMessageIds,
        messagesById,
        canUnpin,
      };
    }

    return state as Complete<StateProps>;
  },
)(HeaderPinnedMessage));
