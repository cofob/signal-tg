import { memo, useCallback, useMemo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiUser, ApiUserStatus } from '../../../api/types';
import { StoryViewerOrigin } from '../../../types';

import { sortUserIds } from '../../../global/helpers';
import { filterPeersByQuery } from '../../../global/helpers/peers';

import useAppLayout from '../../../hooks/useAppLayout';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useInfiniteScroll from '../../../hooks/useInfiniteScroll';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import PrivateChatInfo from '../../common/PrivateChatInfo';
import FloatingActionButton from '../../ui/FloatingActionButton';
import InfiniteScroll from '../../ui/InfiniteScroll';
import ListItem from '../../ui/ListItem';
import Loading from '../../ui/Loading';

export type OwnProps = {
  filter: string;
  isActive: boolean;
  onReset: () => void;
};

// Separators people type in phone numbers
const PHONE_SEPARATORS = /[\s().-]/g;
// An international number: an optional `+`, a country code and at most 15 digits in all
const PHONE_PATTERN = /^\+?[1-9]\d{6,14}$/;

type StateProps = {
  usersById: Record<string, ApiUser>;
  userStatusesById: Record<string, ApiUserStatus>;
  contactIds?: string[];
};

const ContactList = ({
  isActive,
  filter,
  usersById,
  userStatusesById,
  contactIds,
  onReset,
}: OwnProps & StateProps) => {
  const {
    openChat,
    openChatByPhoneNumber,
    openNewContactDialog,
  } = getActions();

  const lang = useLang();
  const { isMobile } = useAppLayout();

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  const handleClick = useCallback((id: string) => {
    openChat({ id, shouldReplaceHistory: true });
  }, [openChat]);

  const listIds = useMemo(() => {
    if (!contactIds) {
      return undefined;
    }

    const filteredIds = filterPeersByQuery({ ids: contactIds, query: filter, type: 'user' });

    return sortUserIds(filteredIds, usersById, userStatusesById);
  }, [contactIds, filter, usersById, userStatusesById]);

  const [viewportIds, getMore] = useInfiniteScroll(undefined, listIds, Boolean(filter));

  // A number without a contact can belong to a Signal user, whom the contact discovery service finds on request
  const phoneQuery = filter.replace(PHONE_SEPARATORS, '');
  const searchPhoneNumber = listIds && !listIds.length && PHONE_PATTERN.test(phoneQuery)
    ? phoneQuery.replace('+', '') : undefined;

  const handlePhoneSearchClick = useLastCallback(() => {
    openChatByPhoneNumber({ phoneNumber: searchPhoneNumber! });
  });

  return (
    <InfiniteScroll items={viewportIds} onLoadMore={getMore} className="chat-list custom-scroll">
      {searchPhoneNumber && (
        <ListItem key="phone-search" icon="phone" className="chat-item-clickable" onClick={handlePhoneSearchClick}>
          {lang('SignalPhoneSearch', { phone: `+${searchPhoneNumber}` })}
        </ListItem>
      )}
      {viewportIds?.length ? (
        viewportIds.map((id) => (
          <ListItem
            key={id}
            className="chat-item-clickable contact-list-item"
            onClick={() => handleClick(id)}
          >
            <PrivateChatInfo
              userId={id}
              forceShowSelf
              avatarSize="large"
              withStory
              storyViewerOrigin={StoryViewerOrigin.ChatList}
              ripple={!isMobile}
            />
          </ListItem>
        ))
      ) : viewportIds && !viewportIds.length ? (
        !searchPhoneNumber && (
          <p className="no-results" key="no-results" dir="auto">
            {lang(filter.length ? 'NoContactsFound' : 'ContactListEmpty')}
          </p>
        )
      ) : (
        <Loading key="loading" />
      )}
      <FloatingActionButton
        key="create-new-contact"
        isShown
        onClick={openNewContactDialog}
        ariaLabel={lang('CreateNewContact')}
        iconName="add-user-filled"
      />
    </InfiniteScroll>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const { userIds: contactIds } = global.contactList || {};
    const { byId: usersById, statusesById: userStatusesById } = global.users;

    return {
      usersById,
      userStatusesById,
      contactIds,
    };
  },
)(ContactList));
