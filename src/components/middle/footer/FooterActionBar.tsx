import { memo, useRef } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { IconName } from '../../../types/icons';

import { MUTE_INDEFINITE_TIMESTAMP, UNMUTE_TIMESTAMP } from '../../../config';
import buildClassName from '../../../util/buildClassName';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';

import styles from './FooterActionBar.module.scss';

type OwnProps = {
  chatId: string;
  isChannel?: boolean;
  canSubscribe?: boolean;
  shouldJoinToSend?: boolean;
  shouldSendJoinRequest?: boolean;
  canUnblock?: boolean;
  isChannelMuteBar?: boolean;
  isMuted?: boolean;
  linkedMonoforumId?: string;
  canUnpinAll?: boolean;
  pinnedMessagesCount?: number;
  canOpenSavedChat?: boolean;
  savedChatId?: string;
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
  isChannel,
  canSubscribe,
  shouldJoinToSend,
  shouldSendJoinRequest,
  canUnblock,
  isChannelMuteBar,
  isMuted,
  linkedMonoforumId,
  canUnpinAll,
  pinnedMessagesCount,
  canOpenSavedChat,
  savedChatId,
  onUnpinAll,
}: OwnProps) => {
  const {
    joinChannel,
    unblockUser,
    updateChatMutedState,
    openChat,
  } = getActions();

  const lang = useLang();

  const handleSubscribeClick = useLastCallback(() => {
    joinChannel({ chatId });
  });

  const handleUnblock = useLastCallback(() => {
    unblockUser({ userId: chatId });
  });

  const handleToggleMute = useLastCallback(() => {
    updateChatMutedState({ chatId, mutedUntil: isMuted ? UNMUTE_TIMESTAMP : MUTE_INDEFINITE_TIMESTAMP });
  });

  const handleOpenDirect = useLastCallback(() => {
    openChat({ id: linkedMonoforumId });
  });

  const handleOpenSavedChat = useLastCallback(() => {
    openChat({ id: savedChatId! });
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
    if (canOpenSavedChat) {
      return {
        key: 'openSavedChat',
        label: lang('SavedOpenChat'),
        isPrimary: true,
        onClick: handleOpenSavedChat,
      };
    }
    if (shouldSendJoinRequest) {
      return {
        key: 'ChannelJoinRequest',
        label: lang('ChannelJoinRequest'),
        isPrimary: true,
        onClick: handleSubscribeClick,
      };
    }
    if (canSubscribe || shouldJoinToSend) {
      return {
        key: isChannel ? 'ProfileJoinChannel' : 'ProfileJoinGroup',
        label: lang(isChannel ? 'ProfileJoinChannel' : 'ProfileJoinGroup'),
        isPrimary: true,
        onClick: handleSubscribeClick,
      };
    }
    if (canUnblock) {
      return { key: 'Unblock', label: lang('Unblock'), isPrimary: true, onClick: handleUnblock };
    }
    if (isChannelMuteBar) {
      return {
        key: isMuted ? 'ChatsUnmute' : 'ChatsMute',
        label: lang(isMuted ? 'ChatsUnmute' : 'ChatsMute'),
        isPrimary: false,
        onClick: handleToggleMute,
      };
    }

    return undefined;
  })();

  const withChannelSideActions = !canUnpinAll && !canOpenSavedChat;
  const withDirect = Boolean(withChannelSideActions && isChannel && linkedMonoforumId);

  const hadDirectOnMountRef = useRef(withDirect);

  if (!mainButton) {
    return undefined;
  }

  const directClassName = buildClassName(styles.sideButton, !hadDirectOnMountRef.current && styles.appearing);

  return (
    <div className={styles.root} data-footer-action-bar dir={lang.isRtl ? 'rtl' : undefined}>
      <div className={styles.plate}>
        {withDirect && (
          <div className={styles.sideSlot}>
            <Button
              round
              color="translucent"
              className={directClassName}
              ariaLabel={lang('ChannelSendMessage')}
              iconName="direct"
              onClick={handleOpenDirect}
            />
          </div>
        )}
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
