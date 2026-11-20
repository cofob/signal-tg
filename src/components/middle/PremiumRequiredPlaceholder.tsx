import { memo } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type { ApiUser } from '../../api/types';

import { getUserFirstOrLastName } from '../../global/helpers';
import { selectUser } from '../../global/selectors';

import useLang from '../../hooks/useLang';

type OwnProps = {
  userId: string;
};

type StateProps = {
  user?: ApiUser;
};

function PremiumRequiredPlaceholder({ user }: StateProps) {
  const lang = useLang();
  const userName = getUserFirstOrLastName(lang, user);

  return (
    <div>{lang('ChatMessagingRestrictedPlaceholder', { user: userName })}</div>
  );
}

export default memo(withGlobal<OwnProps>(
  (global, { userId }): Complete<StateProps> => {
    const user = selectUser(global, userId);

    return {
      user,
    };
  },
)(PremiumRequiredPlaceholder));
