import { memo, useMemo } from '../../../lib/teact/teact';

import type { ApiUser } from '../../../api/types';
import type { AccountInfo, CustomPeer } from '../../../types';

import { temporarilySuspendCacheUpdate } from '../../../global/cache';
import { getCurrentProdAccountCount } from '../../../global/helpers';
import { IS_SAFARI } from '../../../util/browser/windowEnvironment';
import { getAccountSlotUrl } from '../../../util/multiaccount';
import { LIMITS } from '../../../limits';
import { REM } from '../../common/helpers/mediaDimensions';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import useMultiaccountInfo from '../../../hooks/useMultiaccountInfo';

import Avatar from '../../common/Avatar';
import FullNameTitle from '../../common/FullNameTitle';
import MenuItem from '../../ui/MenuItem';
import MenuSeparator from '../../ui/MenuSeparator';

type OwnProps = {
  currentUser: ApiUser;
  onSelectCurrent?: VoidFunction;
  onSwitchAccount: (url: string) => void;
};

const AccountMenuItems = ({
  currentUser,
  onSelectCurrent,
  onSwitchAccount,
}: OwnProps) => {
  const lang = useLang();
  const accounts = useMultiaccountInfo(currentUser);

  const currentCount = getCurrentProdAccountCount();

  const currentAccountInfo = useMemo(() => {
    return Object.values(accounts).find((account) => account.userId === currentUser.id);
  }, [accounts, currentUser.id]);

  const handleAccountClick = useLastCallback((account: AccountInfo, e: React.SyntheticEvent<HTMLElement>) => {
    if (account.userId === currentUser.id) {
      onSelectCurrent?.();
      return;
    }

    handleAccountNavigation(e);
  });

  const handleNewAccountClick = useLastCallback((e: React.SyntheticEvent<HTMLElement>) => {
    handleAccountNavigation(e);
  });

  function handleAccountNavigation(e: React.SyntheticEvent<HTMLElement>) {
    if (!(e instanceof MouseEvent) || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey
      || !(e.currentTarget instanceof HTMLAnchorElement)) {
      return;
    }

    e.preventDefault();
    // IDB locks up if we write large payload on navigation
    if (IS_SAFARI) temporarilySuspendCacheUpdate();
    onSwitchAccount(e.currentTarget.href);
  }

  const newAccountUrl = useMemo(() => {
    if (!Object.values(accounts).length) {
      return undefined;
    }

    if (currentCount >= LIMITS.moreAccounts) {
      return undefined;
    }

    let freeIndex = 1;
    while (accounts[freeIndex]) {
      freeIndex += 1;
    }

    return getAccountSlotUrl(freeIndex, true);
  }, [accounts, currentCount]);

  return (
    <>
      {Object.entries(accounts || {})
        .sort(([, account]) => (account.userId === currentUser.id ? -1 : 1))
        .map(([slot, account], index, arr) => {
          const isSameServer = account.isTest === currentAccountInfo?.isTest;
          const mockUser: CustomPeer = {
            title: [account.firstName, account.lastName].filter(Boolean).join(' '),
            isCustomPeer: true,
            peerColorId: account.color,
            emojiStatusId: isSameServer ? account.emojiStatusId : undefined,
            isPremium: account.isPremium,
          };

          const hasSeparator = account.userId === currentUser.id && (newAccountUrl || arr.length > 1);

          return (
            <>
              <MenuItem
                className="account-menu-item"
                customIcon={(
                  <Avatar
                    size="mini"
                    className="account-avatar"
                    peer={mockUser}
                    previewUrl={account.avatarUri}
                  />
                )}
                onClick={(e) => handleAccountClick(account, e)}
                href={account.userId !== currentUser.id ? getAccountSlotUrl(Number(slot)) : undefined}
              >
                {account.isTest && <span className="account-menu-item-test">T</span>}
                <FullNameTitle peer={mockUser} withEmojiStatus emojiStatusSize={REM} />
              </MenuItem>
              {hasSeparator && <MenuSeparator />}
            </>
          );
        })}
      {newAccountUrl && (
        <MenuItem
          icon="add"
          rel="noopener" // Allow referrer to be passed
          href={newAccountUrl}
          onClick={handleNewAccountClick}
        >
          {lang('MenuAddAccount')}
        </MenuItem>
      )}
    </>
  );
};

export default memo(AccountMenuItems);
