import { memo, useEffect, useRef } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { GlobalState } from '../../global/types';
import type { FolderEditDispatch } from '../../hooks/reducers/useFoldersReducer';

import { ANIMATION_END_DELAY } from '../../config';
import buildClassName from '../../util/buildClassName';
import { ANIMATION_DURATION } from '../story/helpers/ribbonAnimation';

import useHistoryBack from '../../hooks/useHistoryBack';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import useScrolledState from '../../hooks/useScrolledState';
import useShowTransitionDeprecated from '../../hooks/useShowTransitionDeprecated';

import StoryRibbon from '../story/StoryRibbon';
import StoryToggler from '../story/StoryToggler';
import Button from '../ui/Button';
import DropdownMenu from '../ui/DropdownMenu';
import MenuItem from '../ui/MenuItem';
import ChatList from './main/ChatList';

import './ArchivedChats.scss';

export type OwnProps = {
  isActive: boolean;
  archiveSettings: GlobalState['archiveSettings'];
  isStoryRibbonShown?: boolean;
  onReset: () => void;
  foldersDispatch: FolderEditDispatch;
};

const ArchivedChats = ({
  isActive,
  archiveSettings,
  isStoryRibbonShown,
  onReset,
  foldersDispatch,
}: OwnProps) => {
  const { updateArchiveSettings } = getActions();
  const containerRef = useRef<HTMLDivElement>();
  const lang = useLang();
  const { isAtBeginning, handleScroll, updateScrollState } = useScrolledState();
  const isScrolled = !isAtBeginning;

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  const handleDisplayArchiveInChats = useLastCallback(() => {
    updateArchiveSettings({ isHidden: false });
  });

  const {
    shouldRender: shouldRenderStoryRibbon,
    transitionClassNames: storyRibbonClassNames,
    isClosing: isStoryRibbonClosing,
  } = useShowTransitionDeprecated(
    isStoryRibbonShown, undefined, undefined, '', false, ANIMATION_DURATION + ANIMATION_END_DELAY,
  );

  useEffect(() => {
    if (!isActive) return;

    const chatList = containerRef.current?.querySelector<HTMLElement>('.chat-list') ?? undefined;
    updateScrollState(chatList);
  }, [isActive, shouldRenderStoryRibbon, updateScrollState]);

  return (
    <div ref={containerRef} className="ArchivedChats">
      <div
        className={buildClassName(
          'left-header',
          !shouldRenderStoryRibbon && isScrolled && 'left-header-shadow',
        )}
      >
        {lang.isRtl && <div className="DropdownMenuFiller" />}
        <Button
          round
          size="smaller"
          color="translucent"
          onClick={onReset}
          onFileHoverOpen={onReset}
          ariaLabel={lang('AriaBackToChatList')}
          className={buildClassName(lang.isRtl && 'rtl')}
          iconName="arrow-left"
        />
        <h3>{lang('ArchivedChats')}</h3>
        <div className="story-toggler-wrapper">
          <StoryToggler canShow isArchived />
        </div>
        {archiveSettings.isHidden && (
          <DropdownMenu
            className="archived-chats-more-menu"
            positionX="right"
          >
            <MenuItem icon="archive-from-main" onClick={handleDisplayArchiveInChats}>
              {lang('ContextArchiveToList')}
            </MenuItem>
          </DropdownMenu>
        )}
      </div>
      <div
        className={buildClassName(
          'chat-list-wrapper',
          shouldRenderStoryRibbon && 'with-story-ribbon',
          storyRibbonClassNames,
        )}
      >
        {shouldRenderStoryRibbon && (
          <StoryRibbon
            isArchived
            className={buildClassName(isScrolled && 'left-header-shadow')}
            isClosing={isStoryRibbonClosing}
          />
        )}
        <ChatList
          folderType="archived"
          isActive={isActive}
          isMainList
          foldersDispatch={foldersDispatch}
          archiveSettings={archiveSettings}
          isStoryRibbonShown={isStoryRibbonShown}
          onScroll={handleScroll}
        />
      </div>
    </div>
  );
};

export default memo(ArchivedChats);
