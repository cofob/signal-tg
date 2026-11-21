import { memo, useRef } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { ApiPeer } from '../../api/types';
import { StoryViewerOrigin } from '../../types';

import { getPeerTitle } from '../../global/helpers/peers';
import buildClassName from '../../util/buildClassName';
import { isUserId } from '../../util/entities/ids';
import { preventMessageInputBlurWithBubbling } from '../middle/helpers/preventMessageInputBlur';

import useContextMenuHandlers from '../../hooks/useContextMenuHandlers';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import useStoryPreloader from './hooks/useStoryPreloader';

import Avatar from '../common/Avatar';
import Menu from '../ui/Menu';
import MenuItem from '../ui/MenuItem';

import styles from './StoryRibbon.module.scss';

interface OwnProps {
  peer: ApiPeer;
  isArchived?: boolean;
}

function StoryRibbonButton({ peer, isArchived }: OwnProps) {
  const {
    openChat,
    openChatWithInfo,
    openStoryViewer,
    toggleStoriesHidden,
    openStoryComposer,
  } = getActions();

  const lang = useLang();
  const ref = useRef<HTMLDivElement>();

  const isSelf = 'isSelf' in peer && peer.isSelf;
  const isGroup = !isUserId(peer.id);

  useStoryPreloader(peer.id);

  const {
    isContextMenuOpen, contextMenuAnchor,
    handleBeforeContextMenu, handleContextMenu,
    handleContextMenuClose, handleContextMenuHide,
  } = useContextMenuHandlers(ref);

  const getTriggerElement = useLastCallback(() => ref.current);
  const getRootElement = useLastCallback(() => document.body);
  const getMenuElement = useLastCallback(() => ref.current!.querySelector('.story-peer-context-menu .bubble'));
  const getLayout = useLastCallback(() => ({ withPortal: true, isDense: true }));

  const handleClick = useLastCallback(() => {
    if (isContextMenuOpen) return;

    openStoryViewer({ peerId: peer.id, origin: StoryViewerOrigin.StoryRibbon });
  });

  const handleMouseDown = useLastCallback((e: React.MouseEvent<HTMLElement>) => {
    preventMessageInputBlurWithBubbling(e);
    handleBeforeContextMenu(e);
  });

  const handleNewStory = useLastCallback(() => {
    openStoryComposer();
  });

  const handleOpenChat = useLastCallback(() => {
    openChat({ id: peer.id, shouldReplaceHistory: true });
  });

  const handleOpenProfile = useLastCallback(() => {
    openChatWithInfo({ id: peer.id, shouldReplaceHistory: true });
  });

  const handleArchivePeer = useLastCallback(() => {
    toggleStoriesHidden({ peerId: peer.id, isHidden: !isArchived });
  });

  return (
    <div
      ref={ref}
      role="button"
      data-peer-id={peer.id}
      tabIndex={0}
      className={styles.peer}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <Avatar
        peer={peer}
        withStory
        storyViewerOrigin={StoryViewerOrigin.StoryRibbon}
        storyViewerMode="full"
      />
      <div className={buildClassName(styles.name, peer.hasUnreadStories && styles.name_hasUnreadStory)}>
        {isSelf ? lang('StoryRibbonMyStory') : getPeerTitle(lang, peer)}
      </div>
      {contextMenuAnchor !== undefined && (
        <Menu
          isOpen={isContextMenuOpen}
          anchor={contextMenuAnchor}
          getTriggerElement={getTriggerElement}
          getRootElement={getRootElement}
          getMenuElement={getMenuElement}
          getLayout={getLayout}
          className={buildClassName('story-peer-context-menu', styles.contextMenu)}
          autoClose
          withPortal
          onClose={handleContextMenuClose}
          onCloseAnimationEnd={handleContextMenuHide}
        >
          {isSelf ? (
            <MenuItem onClick={handleNewStory} icon="add">
              {lang('StoryNew')}
            </MenuItem>
          ) : (
            <>
              <MenuItem onClick={handleOpenChat} icon="message">
                {lang('StoryMenuSendMessage')}
              </MenuItem>
              <MenuItem onClick={handleOpenProfile} icon={isGroup ? 'group' : 'user'}>
                {lang(isGroup ? 'StoryMenuViewGroup' : 'StoryMenuViewProfile')}
              </MenuItem>
              <MenuItem
                onClick={handleArchivePeer}
                icon={isArchived ? 'eye-outline' : 'eye-crossed-outline'}
              >
                {lang(isArchived ? 'StoryMenuUnarchivePeer' : 'StoryMenuArchivePeer')}
              </MenuItem>
            </>
          )}
        </Menu>
      )}
    </div>
  );
}

export default memo(StoryRibbonButton);
