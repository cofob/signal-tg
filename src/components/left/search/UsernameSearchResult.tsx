import { memo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { TabState } from '../../../global/types';

import { selectTabState } from '../../../global/selectors';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import ListItem from '../../ui/ListItem';
import Spinner from '../../ui/Spinner';

type OwnProps = {
  username: string;
};

type StateProps = {
  status?: NonNullable<TabState['usernameLookup']>['status'];
};

/**
 * Offers to find the Signal user of a username that was typed into a search field. The server lookup runs on the
 * click only, so typing neither tells the server about partial usernames nor counts against its rate limit.
 */
const UsernameSearchResult = ({ username, status }: OwnProps & StateProps) => {
  const { findChatByUsername } = getActions();
  const lang = useLang();

  const handleClick = useLastCallback(() => {
    findChatByUsername({ username });
  });

  return (
    <ListItem
      icon="mention"
      multiline
      narrow
      ripple
      className="chat-item-clickable"
      rightElement={status === 'loading' ? <Spinner /> : undefined}
      onClick={handleClick}
    >
      <span className="title">{lang('SignalUsernameSearch')}</span>
      <span className="subtitle">
        {status === 'notFound' && lang('SignalUsernameSearchNotFound')}
        {status === 'unavailable' && lang('SignalUsernameSearchFailed')}
        {(!status || status === 'loading') && `@${username}`}
      </span>
    </ListItem>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { username }): Complete<StateProps> => {
    const lookup = selectTabState(global).usernameLookup;

    // A status belongs to the username that was looked up, not to whatever is typed next
    return { status: lookup?.username === username ? lookup.status : undefined };
  },
)(UsernameSearchResult));
