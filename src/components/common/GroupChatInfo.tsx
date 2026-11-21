import { memo, useEffect, useMemo } from '../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../global';

import type {
  ApiChat, ApiTypingStatus,
} from '../../api/types';
import type { IconName } from '../../types/icons';
import { MediaViewerOrigin, type StoryViewerOrigin } from '../../types';

import {
  getChatTypeLangKey,
  getGroupStatus,
  getMainUsername,
} from '../../global/helpers';
import {
  selectChat,
  selectChatMessages,
  selectChatOnlineCount,
  selectIsChatRestricted,
} from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import renderText from './helpers/renderText';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Avatar from './Avatar';
import DotAnimation from './DotAnimation';
import FullNameTitle from './FullNameTitle';
import Icon from './icons/Icon';
import TypingStatus from './TypingStatus';

type OwnProps = {
  chatId: string;
  className?: string;
  statusIcon?: IconName;
  typingStatusByPeerId?: Record<string, ApiTypingStatus>;
  avatarSize?: 'tiny' | 'small' | 'medium' | 'large' | 'jumbo';
  status?: string;
  withDots?: boolean;
  withMediaViewer?: boolean;
  withUsername?: boolean;
  withFullInfo?: boolean;
  withUpdatingStatus?: boolean;
  withChatType?: boolean;
  noRtl?: boolean;
  noAvatar?: boolean;
  forceRoundAvatar?: boolean;
  noStatusOrTyping?: boolean;
  withStory?: boolean;
  storyViewerOrigin?: StoryViewerOrigin;
  onClick?: VoidFunction;
};

type StateProps = {
  chat?: ApiChat;
  onlineCount?: number;
  areMessagesLoaded: boolean;
};

const GroupChatInfo = ({
  typingStatusByPeerId,
  className,
  statusIcon,
  avatarSize = 'medium',
  noAvatar,
  forceRoundAvatar,
  status,
  withDots,
  withMediaViewer,
  withUsername,
  withFullInfo,
  withUpdatingStatus,
  withChatType,
  noRtl,
  chat,
  onlineCount,
  areMessagesLoaded,
  noStatusOrTyping,
  withStory,
  storyViewerOrigin,
  onClick,
}: OwnProps & StateProps) => {
  const {
    loadFullChat,
    openMediaViewer,
    loadMoreProfilePhotos,
  } = getActions();

  const lang = useLang();

  const { id: chatId, isMin } = chat || {};
  const isRestricted = selectIsChatRestricted(getGlobal(), chatId!);

  useEffect(() => {
    if (chatId && !isMin) {
      if (withFullInfo) loadFullChat({ chatId });
      if (withMediaViewer) loadMoreProfilePhotos({ peerId: chatId, isPreload: true });
    }
  }, [chatId, isMin, withFullInfo, withMediaViewer]);

  const handleAvatarViewerOpen = useLastCallback(
    (e: React.MouseEvent<HTMLDivElement, MouseEvent>, hasMedia: boolean) => {
      if (chat && hasMedia) {
        e.stopPropagation();
        openMediaViewer({
          isAvatarView: true,
          chatId: chat.id,
          mediaIndex: 0,
          origin: avatarSize === 'jumbo' ? MediaViewerOrigin.ProfileAvatar : MediaViewerOrigin.MiddleHeaderAvatar,
        });
      }
    },
  );

  const mainUsername = useMemo(() => chat && withUsername && getMainUsername(chat), [chat, withUsername]);

  if (!chat) {
    return undefined;
  }

  function renderStatusOrTyping() {
    if (withUpdatingStatus && !areMessagesLoaded && !isRestricted) {
      return (
        <DotAnimation className="status" content={lang('Updating')} />
      );
    }

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

    if (!chat) {
      return undefined;
    }

    if (typingStatusByPeerId) {
      return <TypingStatus typingStatusByPeerId={typingStatusByPeerId} />;
    }

    if (withChatType) {
      return (
        <span className="status" dir="auto">{lang(getChatTypeLangKey(chat))}</span>
      );
    }

    const groupStatusElement = <span className="group-status">{getGroupStatus(lang, chat)}</span>;
    const onlineStatus = onlineCount ? lang('OnlineCount', { count: onlineCount }, { pluralValue: onlineCount })
      : undefined;
    const onlineStatusElement = onlineStatus ? <span className="online-status">{onlineStatus}</span> : undefined;

    return (
      <span className="status">
        {mainUsername && <span className="handle withStatus">{mainUsername}</span>}
        {!onlineStatusElement ? groupStatusElement
          : lang('GroupStatusWithOnline', {
            status: groupStatusElement, onlineCount: onlineStatusElement,
          }, { withNodes: true })}
      </span>
    );
  }

  return (
    <div
      className={
        buildClassName('ChatInfo', className)
      }
      dir={!noRtl && lang.isRtl ? 'rtl' : undefined}
      onClick={onClick}
    >
      {!noAvatar && (
        <>
          <Avatar
            key={chat.id}
            size={avatarSize}
            peer={chat}
            withStory={withStory}
            forceRound={forceRoundAvatar}
            storyViewerOrigin={storyViewerOrigin}
            storyViewerMode="single-peer"
            onClick={withMediaViewer ? handleAvatarViewerOpen : undefined}
          />
        </>
      )}
      <div className="info">
        <FullNameTitle peer={chat} />
        {!noStatusOrTyping && renderStatusOrTyping()}
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const chat = selectChat(global, chatId);
    const onlineCount = chat ? selectChatOnlineCount(global, chat) : undefined;
    const areMessagesLoaded = Boolean(selectChatMessages(global, chatId));

    return {
      chat,
      onlineCount,
      areMessagesLoaded,
    };
  },
)(GroupChatInfo));
