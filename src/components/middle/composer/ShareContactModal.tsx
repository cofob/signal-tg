import { memo, useMemo, useState } from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type { ApiUser } from '../../../api/types';
import type { MessageList } from '../../../types';

import { getUserFullName } from '../../../global/helpers';
import { filterPeersByQuery } from '../../../global/helpers/peers';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import ChatOrUserPicker from '../../common/pickers/ChatOrUserPicker';

type OwnProps = {
  isOpen: boolean;
  messageList: MessageList;
  onClose: NoneToVoidFunction;
};

type StateProps = {
  usersById: Record<string, ApiUser>;
  contactIds?: string[];
  currentUserId?: string;
};

/** Picks a contact to send as a shared contact (Signal `DataMessage.contact`) */
const ShareContactModal = ({
  isOpen,
  messageList,
  usersById,
  contactIds,
  currentUserId,
  onClose,
}: OwnProps & StateProps) => {
  const { sendMessage } = getActions();
  const lang = useLang();
  const [search, setSearch] = useState('');

  const filteredContactIds = useMemo(() => {
    const ids = (contactIds || []).filter((id) => id !== currentUserId);
    return filterPeersByQuery({ ids, query: search, type: 'user' }).sort((firstId, secondId) => (
      (getUserFullName(lang, usersById[firstId]) || '').localeCompare(getUserFullName(lang, usersById[secondId]) || '')
    ));
  }, [contactIds, currentUserId, lang, search, usersById]);

  const handleSelect = useLastCallback((userId: string) => {
    const user = getGlobal().users.byId[userId];
    if (user) {
      sendMessage({
        messageList,
        contact: {
          mediaType: 'contact',
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          phoneNumber: user.phoneNumber,
          userId,
        },
      });
    }
    onClose();
  });

  return (
    <ChatOrUserPicker
      isOpen={isOpen}
      chatOrUserIds={filteredContactIds}
      title={lang('ContactShare')}
      searchPlaceholder={lang('Search')}
      search={search}
      onSearchChange={setSearch}
      onSelectChatOrUser={handleSelect}
      onClose={onClose}
    />
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => ({
    usersById: global.users.byId,
    contactIds: global.contactList?.userIds,
    currentUserId: global.currentUserId,
  }),
)(ShareContactModal));
