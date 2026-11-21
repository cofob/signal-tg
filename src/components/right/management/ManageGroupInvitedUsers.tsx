import { memo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiChatPendingInvite, ApiUser } from '../../../api/types';

import { getUserFullName } from '../../../global/helpers';
import { selectChatFullInfo } from '../../../global/selectors';
import { MEMO_EMPTY_ARRAY } from '../../../util/memo';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';

import PrivateChatInfo from '../../common/PrivateChatInfo';
import Island, { IslandDescription } from '../../gili/layout/Island';
import ListItem, { type MenuItemContextAction } from '../../ui/ListItem';

type OwnProps = {
  chatId: string;
  onClose: NoneToVoidFunction;
  isActive: boolean;
};

type StateProps = {
  usersById: Record<string, ApiUser>;
  invites: ApiChatPendingInvite[];
};

const ManageGroupInvitedUsers = ({
  chatId,
  usersById,
  invites,
  onClose,
  isActive,
}: OwnProps & StateProps) => {
  const { revokeChatInvite } = getActions();

  const lang = useLang();

  useHistoryBack({
    isActive,
    onBack: onClose,
  });

  function getInvitedBy({ inviterId }: ApiChatPendingInvite) {
    const inviter = inviterId ? usersById[inviterId] : undefined;
    return inviter ? lang('GroupInvitedBy', { user: getUserFullName(lang, inviter) }) : undefined;
  }

  function getContextActions({ serviceId }: ApiChatPendingInvite): MenuItemContextAction[] {
    return [{
      title: lang('GroupRevokeInvite'),
      icon: 'delete',
      destructive: true,
      handler: () => revokeChatInvite({ chatId, serviceId }),
    }];
  }

  return (
    <div className="Management">
      <div className="panel-content custom-scroll">
        <IslandDescription>{lang('GroupPendingInvitesDescription')}</IslandDescription>
        {Boolean(invites.length) && (
          <Island dir={lang.isRtl ? 'rtl' : undefined}>
            {invites.map((invite) => (
              <ListItem
                key={invite.serviceId}
                className="chat-item-clickable"
                ripple
                icon={invite.userId ? undefined : 'phone'}
                multiline={!invite.userId}
                contextActions={getContextActions(invite)}
              >
                {invite.userId ? (
                  <PrivateChatInfo userId={invite.userId} status={getInvitedBy(invite)} forceShowSelf />
                ) : (
                  <>
                    <span className="title">{invite.phoneNumber ?? lang('GroupInvitedContact')}</span>
                    <span className="subtitle">{getInvitedBy(invite) ?? lang('GroupInvitedByNumber')}</span>
                  </>
                )}
              </ListItem>
            ))}
          </Island>
        )}
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const { byId: usersById } = global.users;

    return {
      usersById,
      invites: selectChatFullInfo(global, chatId)?.pendingInvites || MEMO_EMPTY_ARRAY,
    };
  },
)(ManageGroupInvitedUsers));
