import { memo } from '@teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiTypingStatus, ApiUpdateConnectionStateType } from '../../../api/types';
import { MAIN_THREAD_ID } from '../../../api/types';

import { selectThreadLocalStateParam, selectThreadReadState } from '../../../global/selectors/threads';
import { isUserId } from '../../../util/entities/ids';

import useConnectionStatus from '../../../hooks/useConnectionStatus';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import GroupChatInfo from '../../common/GroupChatInfo';
import PrivateChatInfo from '../../common/PrivateChatInfo';
import Button from '../../ui/Button';

import styles from './QuickPreviewModalHeader.module.scss';

type OwnProps = {
  chatId: string;
  onClose: VoidFunction;
};

type StateProps = {
  connectionState?: ApiUpdateConnectionStateType;
  isSyncing?: boolean;
  isFetchingDifference?: boolean;
  typingStatusByPeerId?: Record<string, ApiTypingStatus>;
  unreadCount?: number;
  hasUnreadMark?: boolean;
};

const QuickPreviewModalHeader = ({
  chatId,
  connectionState,
  isSyncing,
  isFetchingDifference,
  typingStatusByPeerId,
  unreadCount,
  hasUnreadMark,
  onClose,
}: OwnProps & StateProps) => {
  const lang = useLang();
  const { markChatMessagesRead } = getActions();
  const {
    connectionStatusText,
  } = useConnectionStatus(lang, connectionState, isSyncing || isFetchingDifference, true);

  const handleMarkAsRead = useLastCallback(() => {
    markChatMessagesRead({ id: chatId });
  });

  return (
    <div className={styles.root}>
      {Boolean(unreadCount || hasUnreadMark) && (
        <Button
          round
          color="translucent"
          size="smaller"
          ariaLabel={lang('ChatListContextMarkAsRead')}
          onClick={handleMarkAsRead}
          className={styles.markAsReadButton}
          iconName="readchats"
        />
      )}
      <Button
        round
        color="translucent"
        size="tiny"
        ariaLabel={lang('Close')}
        onClick={onClose}
        className={styles.closeButton}
        iconName="close"
      />
      <div className="modal-title">
        <div className={styles.chatInfoOverride}>
          {isUserId(chatId) ? (
            <PrivateChatInfo
              key={chatId}
              userId={chatId}
              typingStatusByPeerId={typingStatusByPeerId}
              status={connectionStatusText}
              withDots={Boolean(connectionStatusText)}
              withFullInfo={false}
              withMediaViewer={false}
              withStory={false}
              withUpdatingStatus
              noRtl
            />
          ) : (
            <GroupChatInfo
              key={chatId}
              chatId={chatId}
              typingStatusByPeerId={typingStatusByPeerId}
              status={connectionStatusText}
              withDots={Boolean(connectionStatusText)}
              withMediaViewer={false}
              withFullInfo={false}
              withUpdatingStatus
              withStory={false}
              noRtl
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const typingStatusByPeerId = selectThreadLocalStateParam(
      global,
      chatId,
      MAIN_THREAD_ID,
      'typingStatusByPeerId',
    );
    const readState = selectThreadReadState(global, chatId, MAIN_THREAD_ID);
    const unreadCount = readState?.unreadCount;

    return {
      connectionState: global.connectionState,
      isSyncing: global.isSyncing,
      isFetchingDifference: global.isFetchingDifference,
      typingStatusByPeerId,
      unreadCount,
      hasUnreadMark: readState?.hasUnreadMark,
    };
  },
)(QuickPreviewModalHeader));
