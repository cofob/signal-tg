import { memo, useEffect, useMemo } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type {
  ApiChatMember, ApiTypingStatus, ApiUser, ApiUserStatus,
} from '../../api/types';
import type { CustomPeer, StoryViewerOrigin } from '../../types';
import type { IconName } from '../../types/icons';
import { MediaViewerOrigin } from '../../types';

import { REPLIES_USER_ID } from '../../config';
import {
  getMainUsername, getUserStatus, isUserOnline,
} from '../../global/helpers';
import {
  selectChatMessages,
  selectUser,
  selectUserStatus,
} from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import { hasRank } from './helpers/chatMember';
import renderText from './helpers/renderText';

import useIntervalForceUpdate from '../../hooks/schedulers/useIntervalForceUpdate';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import RippleEffect from '../ui/RippleEffect';
import Avatar from './Avatar';
import DotAnimation from './DotAnimation';
import FullNameTitle from './FullNameTitle';
import Icon from './icons/Icon';
import RankBadge from './RankBadge';
import TypingStatus from './TypingStatus';

type BaseOwnProps = {
  typingStatusByPeerId?: Record<string, ApiTypingStatus>;
  avatarSize?: 'tiny' | 'small' | 'medium' | 'large' | 'jumbo';
  forceShowSelf?: boolean;
  status?: string;
  statusIcon?: IconName;
  ripple?: boolean;
  withDots?: boolean;
  withMediaViewer?: boolean;
  withUsername?: boolean;
  withStory?: boolean;
  withFullInfo?: boolean;
  withUpdatingStatus?: boolean;
  storyViewerOrigin?: StoryViewerOrigin;
  noEmojiStatus?: boolean;
  noFake?: boolean;
  noVerified?: boolean;
  emojiStatusSize?: number;
  noStatusOrTyping?: boolean;
  noUserStatus?: boolean;
  noRtl?: boolean;
  chatMemberOriginId?: string;
  chatMember?: ApiChatMember;
  isSavedDialog?: boolean;
  noAvatar?: boolean;
  className?: string;
  iconElement?: React.ReactNode;
  rightElement?: React.ReactNode;
  onClick?: VoidFunction;
  onEmojiStatusClick?: VoidFunction;
};

type OwnProps = BaseOwnProps & ({
  userId: string;
  customPeer?: never;
} | {
  userId?: never;
  customPeer: CustomPeer;
});

type StateProps = {
  user?: ApiUser;
  userStatus?: ApiUserStatus;
  self?: ApiUser;
  isSavedMessages?: boolean;
  areMessagesLoaded: boolean;
  isSynced?: boolean;
};

const UPDATE_INTERVAL = 1000 * 60; // 1 min

const PrivateChatInfo = ({
  userId,
  customPeer,
  typingStatusByPeerId,
  avatarSize = 'medium',
  status,
  statusIcon,
  withDots,
  withMediaViewer,
  withUsername,
  withStory,
  withFullInfo,
  withUpdatingStatus,
  emojiStatusSize,
  noStatusOrTyping,
  noUserStatus,
  noEmojiStatus,
  noFake,
  noVerified,
  noRtl,
  user,
  userStatus,
  self,
  isSavedMessages,
  isSavedDialog,
  areMessagesLoaded,
  chatMember,
  chatMemberOriginId,
  ripple,
  className,
  storyViewerOrigin,
  noAvatar,
  isSynced,
  iconElement,
  rightElement,
  onClick,
  onEmojiStatusClick,
}: OwnProps & StateProps) => {
  const {
    loadFullUser,
    openMediaViewer,
    loadMoreProfilePhotos,
  } = getActions();

  const lang = useLang();

  const hasAvatarMediaViewer = withMediaViewer && !isSavedMessages;

  useEffect(() => {
    if (userId) {
      if (withFullInfo && isSynced) loadFullUser({ userId });
      if (withMediaViewer) loadMoreProfilePhotos({ peerId: userId, isPreload: true });
    }
  }, [userId, withFullInfo, withMediaViewer, isSynced]);

  useIntervalForceUpdate(UPDATE_INTERVAL);

  const handleAvatarViewerOpen = useLastCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>, hasMedia: boolean) => {
      if (hasMedia) {
        e.stopPropagation();
        openMediaViewer({
          isAvatarView: true,
          chatId: userId,
          mediaIndex: 0,
          origin: avatarSize === 'jumbo' ? MediaViewerOrigin.ProfileAvatar : MediaViewerOrigin.MiddleHeaderAvatar,
        });
      }
    },
  );

  const mainUsername = useMemo(() => user && withUsername && getMainUsername(user), [user, withUsername]);

  if (!user && !customPeer) {
    return undefined;
  }

  function renderStatusOrTyping() {
    if (status) {
      return withDots ? (
        <DotAnimation className="status" content={status} />
      ) : (
        <span className="status" dir="auto">
          {statusIcon && <Icon className="status-icon" name={statusIcon} />}
          {renderText(status)}
        </span>
      );
    }

    if (withUpdatingStatus && !areMessagesLoaded) {
      return (
        <DotAnimation className="status" content={lang('Updating')} />
      );
    }

    if (customPeer?.subtitleKey) {
      return (
        <span className="status" dir="auto">
          <span className="user-status" dir="auto">{lang(customPeer.subtitleKey)}</span>
        </span>
      );
    }

    if (!user) {
      return undefined;
    }

    if (typingStatusByPeerId) {
      return <TypingStatus typingStatusByPeerId={typingStatusByPeerId} isPrivate />;
    }

    if (user.id === REPLIES_USER_ID) {
      return undefined;
    }

    const translatedStatus = noUserStatus ? undefined : getUserStatus(lang, user, userStatus);
    const mainUserNameClassName = buildClassName('handle', translatedStatus && 'withStatus');
    return (
      <span className={buildClassName('status', !noUserStatus && isUserOnline(user, userStatus, true) && 'online')}>
        {mainUsername && <span className={mainUserNameClassName}>{mainUsername}</span>}
        {translatedStatus && <span className="user-status" dir="auto">{translatedStatus}</span>}
      </span>
    );
  }

  function renderNameTitle() {
    if (chatMember && hasRank(chatMember)) {
      return (
        <div className="info-name-title">
          <FullNameTitle
            peer={customPeer || user!}
            noFake={noFake}
            noVerified={noVerified}
            withEmojiStatus={!noEmojiStatus}
            emojiStatusSize={emojiStatusSize}
            isSavedMessages={isSavedMessages}
            isSavedDialog={isSavedDialog}
            iconElement={iconElement}
            onEmojiStatusClick={onEmojiStatusClick}
          />
          <RankBadge
            chatId={chatMemberOriginId!}
            userId={chatMember.userId}
            isAdmin={chatMember.isAdmin}
            isOwner={chatMember.isOwner}
            rank={chatMember.rank}
          />
        </div>
      );
    }

    return (
      <FullNameTitle
        peer={customPeer || user!}
        noFake={noFake}
        noVerified={noVerified}
        withEmojiStatus={!noEmojiStatus}
        emojiStatusSize={emojiStatusSize}
        isSavedMessages={isSavedMessages}
        isSavedDialog={isSavedDialog}
        onEmojiStatusClick={onEmojiStatusClick}
        iconElement={iconElement}
      />
    );
  }

  return (
    <div
      className={buildClassName('ChatInfo', className)}
      dir={!noRtl && lang.isRtl ? 'rtl' : undefined}
      onClick={onClick}
    >
      {isSavedDialog && self && (
        <Avatar
          key="saved-messages"
          size={avatarSize}
          peer={self}
          isSavedMessages
          className="saved-dialog-avatar"
        />
      )}
      {!noAvatar && (
        <Avatar
          key={user?.id}
          size={avatarSize}
          peer={customPeer || user}
          className={buildClassName(isSavedDialog && 'overlay-avatar')}
          isSavedMessages={isSavedMessages}
          isSavedDialog={isSavedDialog}
          withStory={withStory}
          storyViewerOrigin={storyViewerOrigin}
          storyViewerMode="single-peer"
          onClick={hasAvatarMediaViewer ? handleAvatarViewerOpen : undefined}
        />
      )}
      <div className="info">
        {renderNameTitle()}
        {(status || (!isSavedMessages && !noStatusOrTyping)) && renderStatusOrTyping()}
      </div>
      {ripple && <RippleEffect />}
      {rightElement}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, {
    userId, forceShowSelf, isSavedDialog,
  }): Complete<StateProps> => {
    const { isSynced } = global;
    const user = userId ? selectUser(global, userId) : undefined;
    const userStatus = userId ? selectUserStatus(global, userId) : undefined;
    const isSavedMessages = !forceShowSelf && user && user.isSelf;
    const self = isSavedMessages ? user : selectUser(global, global.currentUserId!);
    const areMessagesLoaded = Boolean(
      isSavedDialog
        ? selectChatMessages(global, global.currentUserId!)
        : selectChatMessages(global, userId!),
    );

    return {
      user,
      userStatus,
      isSavedMessages,
      areMessagesLoaded,
      self,
      isSynced,
    };
  },
)(PrivateChatInfo));
