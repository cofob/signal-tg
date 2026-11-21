import { memo } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { IconName } from '../../../types/icons';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';

import styles from './FooterActionBar.module.scss';

type OwnProps = {
  chatId: string;
  canJoin?: boolean;
  shouldSendJoinRequest?: boolean;
  canUnblock?: boolean;
  canUnpinAll?: boolean;
  pinnedMessagesCount?: number;
  onUnpinAll?: NoneToVoidFunction;
};

type MainButton = {
  key: string;
  label: string;
  iconName?: IconName;
  isPrimary: boolean;
  onClick: NoneToVoidFunction;
};

const FooterActionBar = ({
  chatId,
  canJoin,
  shouldSendJoinRequest,
  canUnblock,
  canUnpinAll,
  pinnedMessagesCount,
  onUnpinAll,
}: OwnProps) => {
  const {
    joinChannel,
    unblockUser,
  } = getActions();

  const lang = useLang();

  const handleJoinClick = useLastCallback(() => {
    joinChannel({ chatId });
  });

  const handleUnblock = useLastCallback(() => {
    unblockUser({ userId: chatId });
  });

  const mainButton: MainButton | undefined = (() => {
    if (canUnpinAll) {
      return {
        key: 'unpinAll',
        label: lang('ChatPinnedUnpinAll', { count: pinnedMessagesCount! }, {
          pluralValue: pinnedMessagesCount!,
        }),
        iconName: 'unpin',
        isPrimary: false,
        onClick: onUnpinAll!,
      };
    }
    if (shouldSendJoinRequest) {
      return {
        key: 'ChannelJoinRequest',
        label: lang('ChannelJoinRequest'),
        isPrimary: true,
        onClick: handleJoinClick,
      };
    }
    if (canJoin) {
      return {
        key: 'ProfileJoinGroup',
        label: lang('ProfileJoinGroup'),
        isPrimary: true,
        onClick: handleJoinClick,
      };
    }
    if (canUnblock) {
      return { key: 'Unblock', label: lang('Unblock'), isPrimary: true, onClick: handleUnblock };
    }
    return undefined;
  })();

  if (!mainButton) {
    return undefined;
  }

  return (
    <div className={styles.root} data-footer-action-bar dir={lang.isRtl ? 'rtl' : undefined}>
      <div className={styles.plate}>
        <Button
          key={mainButton.key}
          fluid
          ripple
          color={mainButton.isPrimary ? 'primary' : 'secondary'}
          className={styles.centerButton}
          size="smaller"
          iconName={mainButton.iconName}
          noForcedUpperCase
          onClick={mainButton.onClick}
        >
          {mainButton.label}
        </Button>
      </div>
    </div>
  );
};

export default memo(FooterActionBar);
