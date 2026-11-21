import { memo, useMemo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiChatPendingInvite } from '../../../api/types';
import type { GlobalState } from '../../../global/types';

import { getUserFullName } from '../../../global/helpers';
import { selectChatFullInfo, selectUser } from '../../../global/selectors';
import { buildCollectionByKey, unique } from '../../../util/iteratees';
import { MEMO_EMPTY_ARRAY } from '../../../util/memo';

import { useShallowSelector } from '../../../hooks/data/useSelector';
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
  invites: ApiChatPendingInvite[];
};

const ManageGroupInvitedUsers = ({
  chatId,
  invites,
  onClose,
  isActive,
}: OwnProps & StateProps) => {
  const { revokeChatInvite } = getActions();

  const lang = useLang();

  // Only the users that invited are read from the global state
  const selectInviters = useMemo(() => {
    const inviterIds = unique(invites.map(({ inviterId }) => inviterId).filter(Boolean));
    return (global: GlobalState) => buildCollectionByKey(
      inviterIds.map((id) => selectUser(global, id)).filter(Boolean), 'id',
    );
  }, [invites]);
  const usersById = useShallowSelector(selectInviters);

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
    return {
      invites: selectChatFullInfo(global, chatId)?.pendingInvites || MEMO_EMPTY_ARRAY,
    };
  },
)(ManageGroupInvitedUsers));
