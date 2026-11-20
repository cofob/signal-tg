import {
  memo, useEffect, useMemo, useRef,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { MessageList } from '../../types';
import {
  type ApiSticker, type ApiUpdateConnectionStateType,
  MAIN_THREAD_ID,
} from '../../api/types';

import {
  selectChat,
  selectChatLastMessageId,
  selectCurrentMessageList,
} from '../../global/selectors';
import { selectThreadReadState } from '../../global/selectors/threads';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import StickerView from '../common/StickerView';

import styles from './ContactGreeting.module.scss';

type OwnProps = {
  userId: string;
};

type StateProps = {
  defaultStickers?: ApiSticker[];
  areDefaultStickersLoaded: boolean;
  lastMessageId?: number;
  connectionState?: ApiUpdateConnectionStateType;
  currentMessageList?: MessageList;
};

const ContactGreeting = ({
  defaultStickers,
  areDefaultStickersLoaded,
  connectionState,
  lastMessageId,
  currentMessageList,
}: OwnProps & StateProps) => {
  const {
    loadGreetingStickers,
    sendMessage,
    markMessageListRead,
  } = getActions();

  const lang = useLang();

  const containerRef = useRef<HTMLDivElement>();

  const sticker = useMemo(() => {
    if (!defaultStickers?.length) return undefined;

    const randomIndex = Math.floor(Math.random() * defaultStickers.length);
    return defaultStickers[randomIndex];
  }, [defaultStickers]);

  useEffect(() => {
    if (areDefaultStickersLoaded || connectionState !== 'connectionStateReady') {
      return;
    }

    loadGreetingStickers();
  }, [connectionState, loadGreetingStickers, areDefaultStickersLoaded]);

  useEffect(() => {
    if (connectionState === 'connectionStateReady' && lastMessageId) {
      markMessageListRead({ maxId: lastMessageId });
    }
  }, [connectionState, lastMessageId]);

  const handleStickerSelect = useLastCallback(() => {
    if (!currentMessageList || !sticker) {
      return;
    }

    sendMessage({
      sticker,
      messageList: currentMessageList,
    });
  });

  return (
    <div className={styles.root}>
      <div className={styles.wrapper}>
        <p className={styles.title} dir="auto">{lang('ConversationEmptyPlaceholder')}</p>
        <p className={styles.description} dir="auto">{lang('ConversationGreetingText')}</p>

        <div ref={containerRef} className={styles.sticker} onClick={handleStickerSelect}>
          {sticker && (
            <StickerView
              containerRef={containerRef}
              sticker={sticker}
              size={160}
              shouldLoop
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { userId }): Complete<StateProps> => {
    const { stickers, hash } = global.stickers.greeting;
    const chat = selectChat(global, userId);
    if (!chat) {
      return {} as Complete<StateProps>;
    }

    const {
      unreadCount,
    } = selectThreadReadState(global, chat.id, MAIN_THREAD_ID) || {};

    // Pass last message id only if there are unread messages
    const lastMessageId = selectChatLastMessageId(global, chat.id);

    return {
      defaultStickers: stickers,
      areDefaultStickersLoaded: hash !== undefined,
      lastMessageId: unreadCount ? lastMessageId : undefined,
      connectionState: global.connectionState,
      currentMessageList: selectCurrentMessageList(global),
    };
  },
)(ContactGreeting));
