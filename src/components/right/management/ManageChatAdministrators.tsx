import { memo, useMemo } from '../../../lib/teact/teact';
import { getGlobal, withGlobal } from '../../../global';

import type { ApiChat, ApiChatMember } from '../../../api/types';
import { ManagementScreens } from '../../../types';

import { getHasAdminRight, getUserFullName } from '../../../global/helpers';
import { selectChat, selectChatFullInfo } from '../../../global/selectors';
import { partition } from '../../../util/iteratees';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import PrivateChatInfo from '../../common/PrivateChatInfo';
import Island, { IslandDescription } from '../../gili/layout/Island';
import FloatingActionButton from '../../ui/FloatingActionButton';
import ListItem from '../../ui/ListItem';

type OwnProps = {
  chatId: string;
  isActive: boolean;
  onScreenSelect: (screen: ManagementScreens) => void;
  onChatMemberSelect: (memberId: string, isPromotedByCurrentUser?: boolean) => void;
  onClose: NoneToVoidFunction;
};

type StateProps = {
  chat?: ApiChat;
  currentUserId?: string;
  adminMembersById?: Record<string, ApiChatMember>;
};

const ManageChatAdministrators = ({
  isActive,
  chat,
  currentUserId,
  adminMembersById,
  onScreenSelect,
  onChatMemberSelect,
  onClose,
}: OwnProps & StateProps) => {
  const lang = useLang();

  useHistoryBack({
    isActive,
    onBack: onClose,
  });

  const canAddNewAdmins = Boolean(chat && getHasAdminRight(chat, 'addAdmins'));

  const adminMembers = useMemo(() => {
    if (!adminMembersById) {
      return [];
    }

    const [owner, admins] = partition(Object.values(adminMembersById), (member) => member.isOwner);

    return [...owner, ...admins];
  }, [adminMembersById]);

  const handleAdminMemberClick = useLastCallback((member: ApiChatMember) => {
    onChatMemberSelect(member.userId, member.promotedByUserId === currentUserId);
    onScreenSelect(ManagementScreens.ChatAdminRights);
  });

  const handleAddAdminClick = useLastCallback(() => {
    onScreenSelect(ManagementScreens.GroupAddAdmins);
  });

  const getMemberStatus = useLastCallback((member: ApiChatMember) => {
    if (member.isOwner) {
      return lang('ChannelCreator');
    }

    // No need for expensive global updates on users, so we avoid them
    const usersById = getGlobal().users.byId;
    const promotedByUser = member.promotedByUserId ? usersById[member.promotedByUserId] : undefined;

    if (promotedByUser) {
      return lang('EditAdminPromotedBy', { user: getUserFullName(lang, promotedByUser) });
    }

    return lang('ChannelAdmin');
  });

  return (
    <div className="Management">
      <div className="panel-content custom-scroll">
        <Island>
          <ListItem
            icon="clock"
            multiline
            disabled
          >
            <span className="title">{lang('EventLog')}</span>
            <span className="subtitle">{lang('EventLogInfoDetail')}</span>
          </ListItem>
        </Island>

        <IslandDescription dir="auto">
          {lang('GroupManagementAddAdminDescription')}
        </IslandDescription>
        <Island dir={lang.isRtl ? 'rtl' : undefined}>
          {adminMembers.map((member) => (
            <ListItem
              key={member.userId}
              className="chat-item-clickable"

              onClick={() => handleAdminMemberClick(member)}
            >
              <PrivateChatInfo
                userId={member.userId}
                status={getMemberStatus(member)}
                forceShowSelf
              />
            </ListItem>
          ))}

          <FloatingActionButton
            isShown={canAddNewAdmins}
            onClick={handleAddAdminClick}
            ariaLabel={lang('ChannelManagementAddModerator')}
            iconName="add-user-filled"
          />
        </Island>

      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const chat = selectChat(global, chatId);
    return {
      chat,
      currentUserId: global.currentUserId,
      adminMembersById: selectChatFullInfo(global, chatId)?.adminMembersById,
    };
  },
)(ManageChatAdministrators));
