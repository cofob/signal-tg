import { memo, useMemo } from '../../../lib/teact/teact';

import type { ApiUser } from '../../../api/types';
import type { CustomPeer } from '../../../types';

import { temporarilySuspendCacheUpdate } from '../../../global/cache';
import { getCurrentProdAccountCount } from '../../../global/helpers';
import { IS_SAFARI } from '../../../util/browser/windowEnvironment';
import { ACCOUNT_SLOT, getAccountSlotUrl } from '../../../util/multiaccount';
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

  // Signal user ids are local numbers, so different accounts can share an id: the slot tells the accounts apart
  const currentSlot = ACCOUNT_SLOT || 1;
  const currentAccountInfo = accounts[currentSlot];

  const handleAccountClick = useLastCallback((slot: number, e: React.SyntheticEvent<HTMLElement>) => {
    if (slot === currentSlot) {
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
      {Object.entries(accounts)
        .map(([slotKey, account]) => [Number(slotKey), account] as const)
        .sort(([first], [second]) => Number(second === currentSlot) - Number(first === currentSlot) || first - second)
        .map(([slot, account], index, arr) => {
          const isSameServer = account.isTest === currentAccountInfo?.isTest;
          const mockUser: CustomPeer = {
            title: [account.firstName, account.lastName].filter(Boolean).join(' '),
            isCustomPeer: true,
            peerColorId: account.color,
            emojiStatusId: isSameServer ? account.emojiStatusId : undefined,
          };

          const hasSeparator = slot === currentSlot && (newAccountUrl || arr.length > 1);

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
                onClick={(e) => handleAccountClick(slot, e)}
                href={slot !== currentSlot ? getAccountSlotUrl(slot) : undefined}
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
