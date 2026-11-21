import { memo, useEffect } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiCallLogEntry } from '../../../api/types';

import buildClassName from '../../../util/buildClassName';

import useFlag from '../../../hooks/useFlag';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import ConfirmDialog from '../../ui/ConfirmDialog';
import ListItem from '../../ui/ListItem';
import CallLogItem from './CallLogItem';

import styles from './CallLog.module.scss';

type OwnProps = {
  isActive: boolean;
  onReset: NoneToVoidFunction;
};

type StateProps = {
  entries?: ApiCallLogEntry[];
};

/**
 * The calls of the Signal call history, newest first (Signal Desktop calls tab). Calls cannot be made or answered in
 * the app, so the buttons that would call are disabled and say so; a call opens its chat.
 */
const CallLog = ({ isActive, entries, onReset }: OwnProps & StateProps) => {
  const { loadCallLog, clearCallLog, openChat } = getActions();

  const lang = useLang();
  const [isClearing, openClearDialog, closeClearDialog] = useFlag();

  useHistoryBack({ isActive, onBack: onReset });

  useEffect(() => {
    if (isActive) loadCallLog();
  }, [isActive]);

  const handleOpenChat = useLastCallback((chatId: string) => {
    openChat({ id: chatId, shouldReplaceHistory: true });
  });

  const handleConfirmClear = useLastCallback(() => {
    closeClearDialog();
    clearCallLog();
  });

  return (
    <div className={buildClassName('chat-list custom-scroll', styles.root)}>
      <p className={styles.info}>{lang('CallLogInfo')}</p>
      {entries?.map((entry) => (
        <CallLogItem key={`${entry.chatId}/${entry.id}`} entry={entry} onOpenChat={handleOpenChat} />
      ))}
      {entries && !entries.length && (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>{lang('CallLogEmptyTitle')}</div>
          <div>{lang('CallLogEmptyText')}</div>
        </div>
      )}
      {Boolean(entries?.length) && (
        <ListItem icon="delete" destructive narrow onClick={openClearDialog}>
          {lang('CallLogClear')}
        </ListItem>
      )}
      <ConfirmDialog
        isOpen={isClearing}
        title={lang('CallLogClearTitle')}
        text={lang('CallLogClearText')}
        confirmLabel={lang('CallLogClearConfirm')}
        confirmIsDestructive
        confirmHandler={handleConfirmClear}
        onClose={closeClearDialog}
      />
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => ({
    entries: global.callLog,
  }),
)(CallLog));
