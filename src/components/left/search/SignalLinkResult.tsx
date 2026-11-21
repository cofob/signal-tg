import { memo } from '../../../lib/teact/teact';

import type { SignalLink } from '../../../util/signalLinks';

import { openSignalLink } from '../../../util/deeplink';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island from '../../gili/layout/Island';
import ListItem from '../../ui/ListItem';

type OwnProps = {
  link: SignalLink;
  query: string;
};

/** Offers to open a Signal link that was typed or pasted into the search field */
const SignalLinkResult = ({ link, query }: OwnProps) => {
  const lang = useLang();

  const handleClick = useLastCallback(() => {
    openSignalLink(link);
  });

  return (
    <Island className="search-island">
      <ListItem icon="link" multiline narrow ripple className="chat-item-clickable" onClick={handleClick}>
        <span className="title">{lang('SignalLinkSearchOpen')}</span>
        <span className="subtitle">{query.trim()}</span>
      </ListItem>
    </Island>
  );
};

export default memo(SignalLinkResult);
