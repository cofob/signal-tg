import {
  memo, useEffect,
} from '../../../lib/teact/teact';
import { getActions, getGlobal } from '../../../global';

import type { TabState } from '../../../global/types';
import type { ThreadId } from '../../../types';
import { MAIN_THREAD_ID } from '../../../api/types';

import { getPeerTitle } from '../../../global/helpers/peers';
import { selectPeer } from '../../../global/selectors';

import useFlag from '../../../hooks/useFlag';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import RecipientPicker from '../../common/RecipientPicker';

export type OwnProps = {
  modal: TabState['sharePreparedMessageModal'];
};

const SharePreparedMessageModal = ({
  modal,
}: OwnProps) => {
  const {
    closeSharePreparedMessageModal,
    sendInlineBotResult,
    sendWebAppEvent,
    showNotification,
  } = getActions();
  const lang = useLang();
  const isOpen = Boolean(modal);

  const [isShown, markIsShown, unmarkIsShown] = useFlag();

  useEffect(() => {
    if (isOpen) {
      markIsShown();
    }
  }, [isOpen, markIsShown]);

  const { message, filter, webAppKey } = modal || {};

  const handleClose = useLastCallback(() => {
    closeSharePreparedMessageModal();
    if (webAppKey) {
      sendWebAppEvent({
        webAppKey,
        event: {
          eventType: 'prepared_message_failed',
          eventData: { error: 'USER_DECLINED' },
        },
      });
    }
  });

  const handleSelectRecipient = useLastCallback((id: string, threadId?: ThreadId) => {
    if (!message || !webAppKey) return;

    const peer = selectPeer(getGlobal(), id);
    sendInlineBotResult({
      chatId: id,
      threadId: threadId || MAIN_THREAD_ID,
      id: message.result.id,
      queryId: message.result.queryId,
    });
    showNotification({
      message: {
        key: 'BotSharedToOne',
        variables: { peer: getPeerTitle(lang, peer!) },
        options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
      },
    });
    sendWebAppEvent({
      webAppKey,
      event: {
        eventType: 'prepared_message_sent',
      },
    });
    closeSharePreparedMessageModal();
  });

  if (!isOpen && !isShown) {
    return undefined;
  }

  return (
    <RecipientPicker
      isOpen={isOpen}
      title={lang('SelectChat')}
      searchPlaceholder={lang('Search')}
      filter={filter}
      onSelectRecipient={handleSelectRecipient}
      onClose={handleClose}
      onCloseAnimationEnd={unmarkIsShown}
      isLowStackPriority
    />
  );
};

export default memo(SharePreparedMessageModal);
