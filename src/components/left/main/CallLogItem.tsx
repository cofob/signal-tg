import { memo } from '../../../lib/teact/teact';
import { withGlobal } from '../../../global';

import type { ApiCallLogEntry, ApiPeer } from '../../../api/types';

import { selectPeer } from '../../../global/selectors';
import buildClassName from '../../../util/buildClassName';
import { formatDateTime, secondsToDate } from '../../../util/localization/dateFormat';
import { getServerTime } from '../../../util/serverTime';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Avatar from '../../common/Avatar';
import FullNameTitle from '../../common/FullNameTitle';
import Button from '../../ui/Button';
import ListItem from '../../ui/ListItem';

import styles from './CallLogItem.module.scss';

type OwnProps = {
  entry: ApiCallLogEntry;
  onOpenChat: (chatId: string) => void;
};

type StateProps = {
  peer?: ApiPeer;
};

const SECONDS_PER_DAY = 24 * 60 * 60;

/** A call of the call log: who, how it went and when. A call opens its chat. */
const CallLogItem = ({ entry, peer, onOpenChat }: OwnProps & StateProps) => {
  const {
    chatId, callType, outcome, isOutgoing, isUnseen, date,
  } = entry;
  const lang = useLang();

  const handleClick = useLastCallback(() => {
    onOpenChat(chatId);
  });

  const isMissed = !isOutgoing && (outcome === 'missed' || outcome === 'declined');
  const isRecent = getServerTime() - date < SECONDS_PER_DAY;
  // Signal Desktop `CallsList__ItemCallInfo` in `ts/components/CallsList.dom.tsx`
  const description = callType === 'group' ? lang('CallLogGroup') : lang(getDescriptionKey(entry));
  const time = formatDateTime(lang, secondsToDate(date), isRecent ? { time: 'short' } : { date: 'short' });

  return (
    <ListItem className="chat-item-clickable" onClick={handleClick}>
      <div className={styles.root}>
        <Avatar peer={peer} size="large" />
        <div className={styles.info}>
          {peer && <FullNameTitle peer={peer} />}
          <div className={buildClassName(styles.status, isMissed && styles.missed)}>
            {`${description} · ${time}`}
          </div>
        </div>
        {isUnseen && <div className={styles.unseen} />}
        <div title={lang('CallLogCannotCall')}>
          <Button
            round
            size="smaller"
            color="translucent"
            disabled
            iconName={callType === 'audio' ? 'phone' : 'video-outlined'}
            ariaLabel={lang('CallLogCannotCall')}
          />
        </div>
      </div>
    </ListItem>
  );
};

function getDescriptionKey({ outcome, isOutgoing }: ApiCallLogEntry) {
  if (isOutgoing) return 'CallLogOutgoing';
  if (outcome === 'missed') return 'CallLogMissed';
  return outcome === 'declined' ? 'CallLogDeclined' : 'CallLogIncoming';
}

export default memo(withGlobal<OwnProps>(
  (global, { entry }): Complete<StateProps> => ({
    peer: selectPeer(global, entry.chatId),
  }),
)(CallLogItem));
