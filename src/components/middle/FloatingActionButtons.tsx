import { memo, useRef } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { MessageListType, ThreadId, ThreadReadState } from '../../types';

import { selectChat, selectCurrentMessageList, selectCurrentMiddleSearch } from '../../global/selectors';
import { selectThreadReadState } from '../../global/selectors/threads';
import buildClassName from '../../util/buildClassName';

import useLastCallback from '../../hooks/useLastCallback';

import ScrollDownButton from './ScrollDownButton';

import styles from './FloatingActionButtons.module.scss';

type OwnProps = {
  withScrollDown: boolean;
  isHidden?: boolean;
};

type StateProps = {
  chatId?: string;
  messageListType?: MessageListType;
  threadId?: ThreadId;
  threadReadState?: ThreadReadState;
  shouldShowCount?: boolean;
};

const FloatingActionButtons = ({
  withScrollDown,
  isHidden,
  messageListType,
  chatId,
  threadId,
  threadReadState,
  shouldShowCount,
}: OwnProps & StateProps) => {
  const {
    focusNextReply,
    focusNextMention,
    readAllMentions,
    scrollMessageListToBottom,
  } = getActions();

  const elementRef = useRef<HTMLDivElement>();

  const { unreadMentionsCount, unreadCount } = (shouldShowCount && threadReadState) || {};

  const hasUnreadMentions = Boolean(unreadMentionsCount);

  const handleReadAllMentions = useLastCallback(() => {
    if (!chatId) return;
    readAllMentions({ chatId, threadId });
  });

  const handleScrollDownClick = useLastCallback(() => {
    if (!withScrollDown) {
      return;
    }

    if (messageListType === 'thread') {
      focusNextReply();
    } else {
      scrollMessageListToBottom();
    }
  });

  const handleFocusNextMention = useLastCallback(() => {
    if (!chatId) return;
    focusNextMention({ chatId, threadId });
  });

  const fabClassName = buildClassName(
    styles.root,
    !isHidden && (withScrollDown || hasUnreadMentions) && styles.revealed,
    !isHidden && hasUnreadMentions && !withScrollDown && styles.hideScrollDown,
  );

  return (
    <div ref={elementRef} className={fabClassName} inert={isHidden} data-floating-action-buttons>
      <ScrollDownButton
        icon="mention"
        ariaLabelLang="AccDescrMentionDown"
        onClick={handleFocusNextMention}
        onReadAll={handleReadAllMentions}
        unreadCount={unreadMentionsCount}
        className={buildClassName(styles.unreadCountButton, !hasUnreadMentions && styles.hidden)}
      />

      <ScrollDownButton
        icon="arrow-down"
        ariaLabelLang="AccDescrPageDown"
        onClick={handleScrollDownClick}
        unreadCount={unreadCount}
        className={styles.unread}
      />
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const currentMessageList = selectCurrentMessageList(global);
    if (!currentMessageList) {
      return {
        chatId: undefined,
        messageListType: undefined,
        shouldShowCount: undefined,
        threadId: undefined,
        threadReadState: undefined,
      };
    }

    const { chatId, threadId, type: messageListType } = currentMessageList;
    const chat = selectChat(global, chatId);
    const hasActiveMiddleSearch = Boolean(selectCurrentMiddleSearch(global));

    const shouldShowCount = chat && messageListType === 'thread' && !hasActiveMiddleSearch;

    return {
      messageListType,
      chatId,
      threadId,
      threadReadState: selectThreadReadState(global, chatId, threadId),
      shouldShowCount,
    };
  },
)(FloatingActionButtons));
