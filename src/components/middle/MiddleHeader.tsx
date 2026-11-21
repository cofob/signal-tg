import {
  memo, useRef,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type {
  ApiChat, ApiTypingStatus,
} from '../../api/types';
import type { GlobalState } from '../../global/types';
import type { Signal } from '../../util/signals';
import { MAIN_THREAD_ID } from '../../api/types';
import { type MessageListType, StoryViewerOrigin, type ThreadId } from '../../types';

import {
  EDITABLE_INPUT_CSS_SELECTOR,
  MIN_SCREEN_WIDTH_FOR_STATIC_LEFT_COLUMN,
} from '../../config';
import {
  selectChat,
  selectIsChatWithSelf,
  selectIsInSelectMode,
  selectIsRightColumnShown,
  selectPinnedIds,
  selectScheduledIds,
  selectTabState,
} from '../../global/selectors';
import {
  selectThreadLocalStateParam,
} from '../../global/selectors/threads';
import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { IS_MAC_OS } from '../../util/browser/windowEnvironment';
import buildClassName from '../../util/buildClassName';
import { isUserId } from '../../util/entities/ids';

import useAppLayout from '../../hooks/useAppLayout';
import useConnectionStatus from '../../hooks/useConnectionStatus';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import useLongPress from '../../hooks/useLongPress';
import usePreviousDeprecated from '../../hooks/usePreviousDeprecated';
import useWindowSize from '../../hooks/window/useWindowSize';

import GroupChatInfo from '../common/GroupChatInfo';
import PrivateChatInfo from '../common/PrivateChatInfo';
import UnreadCounter from '../common/UnreadCounter';
import Button from '../ui/Button';
import Transition from '../ui/Transition';
import HeaderActions from './HeaderActions';

import './MiddleHeader.scss';

const BACK_BUTTON_INACTIVE_TIME = 450;
const SEARCH_LONGTAP_THRESHOLD = 500;

type OwnProps = {
  chatId: string;
  threadId: ThreadId;
  messageListType: MessageListType;
  isMobile?: boolean;
  getCurrentPinnedIndex: Signal<number>;
  getLoadingPinnedId: Signal<number | undefined>;
  onFocusPinnedMessage: (messageId: number) => void;
};

type StateProps = {
  chat?: ApiChat;
  typingStatusByPeerId?: Record<string, ApiTypingStatus>;
  isSelectModeActive?: boolean;
  isLeftColumnShown?: boolean;
  isRightColumnShown?: boolean;
  messagesCount?: number;
  isChatWithSelf?: boolean;
  shouldSkipHistoryAnimations?: boolean;
  currentTransitionKey: number;
  connectionState?: GlobalState['connectionState'];
  isSyncing?: boolean;
  isFetchingDifference?: boolean;
};

const MiddleHeader = ({
  chatId,
  threadId,
  messageListType,
  isMobile,
  typingStatusByPeerId,
  isSelectModeActive,
  isLeftColumnShown,
  chat,
  messagesCount,
  isChatWithSelf,
  shouldSkipHistoryAnimations,
  currentTransitionKey,
  connectionState,
  isSyncing,
  isFetchingDifference,
  getCurrentPinnedIndex,
  getLoadingPinnedId,
  onFocusPinnedMessage,
}: OwnProps & StateProps) => {
  const {
    openChatWithInfo,
    openChat,
    openPreviousChat,
    toggleLeftColumn,
    exitMessageSelectMode,
    updateMiddleSearch,
  } = getActions();

  const lang = useLang();

  const isBackButtonActiveRef = useRef(true);
  const { isTablet } = useAppLayout();

  const { width: windowWidth } = useWindowSize();

  const isLeftColumnHideable = windowWidth <= MIN_SCREEN_WIDTH_FOR_STATIC_LEFT_COLUMN;
  const shouldShowCloseButton = isTablet && isLeftColumnShown;

  const componentRef = useRef<HTMLDivElement>();

  const handleOpenSearch = useLastCallback(() => {
    updateMiddleSearch({ chatId, threadId, update: {} });
  });

  const handleOpenChat = useLastCallback((event: React.MouseEvent | React.TouchEvent) => {
    if ((event.target as Element).closest('.title > .custom-emoji')) return;

    // Force close My Profile if clicked on Saved Messages header
    openChatWithInfo({ id: chatId, isOwnProfile: false });
  });

  const {
    onMouseDown: handleLongPressMouseDown,
    onMouseUp: handleLongPressMouseUp,
    onMouseLeave: handleLongPressMouseLeave,
    onTouchStart: handleLongPressTouchStart,
    onTouchEnd: handleLongPressTouchEnd,
  } = useLongPress({
    onStart: handleOpenSearch,
    onClick: handleOpenChat,
    threshold: SEARCH_LONGTAP_THRESHOLD,
  });

  const setBackButtonActive = useLastCallback(() => {
    setTimeout(() => {
      isBackButtonActiveRef.current = true;
    }, BACK_BUTTON_INACTIVE_TIME);
  });

  const navigateBack = useLastCallback(() => {
    if (!isBackButtonActiveRef.current) return;

    // Workaround for missing UI when quickly clicking the Back button
    isBackButtonActiveRef.current = false;
    if (isMobile) {
      const messageInput = document.querySelector<HTMLDivElement>(EDITABLE_INPUT_CSS_SELECTOR);
      messageInput?.blur();
    }

    if (isSelectModeActive) {
      exitMessageSelectMode();
      setBackButtonActive();
      return;
    }

    if (messageListType === 'thread' && currentTransitionKey === 0) {
      if (!isTablet || shouldShowCloseButton) {
        openChat({ id: undefined }, { forceOnHeavyAnimation: true });
      } else {
        toggleLeftColumn();
      }

      setBackButtonActive();

      return;
    }

    openPreviousChat();
    setBackButtonActive();
  });

  const handleBackClick = useLastCallback((e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    if (
      isBackButtonActiveRef.current
      && messageListType === 'thread'
      && currentTransitionKey === 0
      && (!isTablet || shouldShowCloseButton)
    ) {
      e.stopPropagation(); // Stop propagation to prevent chat re-opening on tablets
    }

    navigateBack();
  });

  const prevTransitionKey = usePreviousDeprecated(currentTransitionKey);

  const cleanupExceptionKey = (
    prevTransitionKey !== undefined && prevTransitionKey < currentTransitionKey ? prevTransitionKey : undefined
  );

  const { connectionStatusText } = useConnectionStatus(
    lang, connectionState, isSyncing || isFetchingDifference, true,
  );

  function renderInfoTitle() {
    if (messagesCount === undefined) {
      return lang('Loading');
    }

    if (messageListType === 'pinned') {
      return lang('PinnedMessagesCount', { count: messagesCount }, { pluralValue: messagesCount });
    }

    if (messageListType === 'scheduled') {
      if (isChatWithSelf) {
        return lang('Reminders');
      }

      return lang('Messages', { count: messagesCount }, { pluralValue: messagesCount });
    }

    return undefined;
  }

  function renderInfo() {
    if (messageListType === 'thread') {
      if (threadId === MAIN_THREAD_ID) {
        return renderChatInfo();
      }
    }

    return (
      <>
        {renderBackButton(currentTransitionKey === 0)}
        <h3>{renderInfoTitle()}</h3>
      </>
    );
  }

  function renderChatInfo() {
    const displayChatId = chatId;
    return (
      <>
        {(isLeftColumnHideable || currentTransitionKey > 0) && renderBackButton(shouldShowCloseButton, true)}
        <div
          className="chat-info-wrapper"
          onMouseDown={handleLongPressMouseDown}
          onMouseUp={handleLongPressMouseUp}
          onMouseLeave={handleLongPressMouseLeave}
          onTouchStart={handleLongPressTouchStart}
          onTouchEnd={handleLongPressTouchEnd}
        >
          {isUserId(displayChatId) ? (
            <PrivateChatInfo
              key={displayChatId}
              userId={displayChatId}
              typingStatusByPeerId={typingStatusByPeerId}
              status={connectionStatusText}
              withDots={Boolean(connectionStatusText)}
              withFullInfo={threadId === MAIN_THREAD_ID}
              withMediaViewer={threadId === MAIN_THREAD_ID}
              withStory={!isChatWithSelf}
              withUpdatingStatus
              storyViewerOrigin={StoryViewerOrigin.MiddleHeaderAvatar}
              noRtl
            />
          ) : (
            <GroupChatInfo
              key={displayChatId}
              chatId={displayChatId}
              typingStatusByPeerId={typingStatusByPeerId}
              status={connectionStatusText}
              withDots={Boolean(connectionStatusText)}
              withMediaViewer={threadId === MAIN_THREAD_ID}
              withFullInfo={threadId === MAIN_THREAD_ID}
              withUpdatingStatus
              withStory
              storyViewerOrigin={StoryViewerOrigin.MiddleHeaderAvatar}
              forceRoundAvatar
              noRtl
            />
          )}
        </div>
      </>
    );
  }

  function renderBackButton(asClose = false, withUnreadCounter = false) {
    return (
      <div className="back-button">
        <Button
          round
          size="smaller"
          color="translucent"
          onClick={handleBackClick}
          onFileHoverOpen={navigateBack}
          ariaLabel={lang(asClose ? 'Close' : 'Back')}
        >
          <div className={buildClassName('animated-close-icon', !asClose && 'state-back')} />
        </Button>
        {withUnreadCounter && <UnreadCounter />}
      </div>
    );
  }

  return (
    <div
      className="MiddleHeader"
      ref={componentRef}
      data-tauri-drag-region={IS_TAURI && IS_MAC_OS ? true : undefined}
    >
      <Transition
        name={shouldSkipHistoryAnimations ? 'none' : 'slideFade'}
        activeKey={currentTransitionKey}
        shouldCleanup
        cleanupExceptionKey={cleanupExceptionKey}
      >
        {renderInfo()}
      </Transition>
      <div className="header-tools">
        <HeaderActions
          chatId={chatId}
          threadId={threadId}
          messageListType={messageListType}
          isMobile={isMobile}
        />
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, {
    chatId, threadId, messageListType, isMobile,
  }): Complete<StateProps> => {
    const {
      isLeftColumnShown, shouldSkipHistoryAnimations, messageLists,
    } = selectTabState(global);
    const chat = selectChat(global, chatId);

    let messagesCount: number | undefined;
    if (messageListType === 'pinned') {
      const pinnedIds = selectPinnedIds(global, chatId, threadId);
      messagesCount = pinnedIds?.length;
    } else if (messageListType === 'scheduled') {
      const scheduledIds = selectScheduledIds(global, chatId, threadId);
      messagesCount = scheduledIds?.length;
    }

    const typingStatusByPeerId = selectThreadLocalStateParam(global, chatId, threadId, 'typingStatusByPeerId');

    return {
      typingStatusByPeerId,
      isLeftColumnShown,
      isRightColumnShown: selectIsRightColumnShown(global, isMobile),
      isSelectModeActive: selectIsInSelectMode(global),
      chat,
      messagesCount,
      isChatWithSelf: selectIsChatWithSelf(global, chatId),
      shouldSkipHistoryAnimations,
      currentTransitionKey: Math.max(0, messageLists.length - 1),
      connectionState: global.connectionState,
      isSyncing: global.isSyncing,
      isFetchingDifference: global.isFetchingDifference,
    };
  },
)(MiddleHeader));
