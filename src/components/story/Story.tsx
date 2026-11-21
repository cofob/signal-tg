import {
  memo, useEffect, useMemo, useRef, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type {
  ApiChat,
  ApiPeer, ApiStory, ApiTypeStory,
} from '../../api/types';
import type { IDimensions } from '../../types';
import type { AdvancedLangFnOptions } from '../../util/localization/types';
import type { Signal } from '../../util/signals';
import { MAIN_THREAD_ID } from '../../api/types';

import { EDITABLE_STORY_INPUT_CSS_SELECTOR, EDITABLE_STORY_INPUT_ID } from '../../config';
import { isChatChannel } from '../../global/helpers';
import { getPeerTitle } from '../../global/helpers/peers';
import {
  selectChat,
  selectIsCurrentUserFrozen,
  selectPeer,
  selectPeerStory,
  selectPerformanceSettingsValue,
  selectTabState,
  selectUser,
  selectUserFullInfo,
} from '../../global/selectors';
import { IS_SAFARI } from '../../util/browser/windowEnvironment';
import buildClassName from '../../util/buildClassName';
import captureKeyboardListeners from '../../util/captureKeyboardListeners';
import download from '../../util/download';
import { isUserId } from '../../util/entities/ids';
import { getIsKeyboardShortcut } from '../../util/keyboardShortcuts';
import { formatRecentTimestamp, secondsToDate } from '../../util/localization/dateFormat';
import { round } from '../../util/math';
import { getServerTime } from '../../util/serverTime';
import renderText from '../common/helpers/renderText';
import { BASE_STORY_HEIGHT, BASE_STORY_WIDTH } from './helpers/dimensions';
import { PRIMARY_VIDEO_MIME, SECONDARY_VIDEO_MIME } from './helpers/videoFormats';

import useUnsupportedMedia from '../../hooks/media/useUnsupportedMedia';
import useAppLayout, { getIsMobile } from '../../hooks/useAppLayout';
import useCanvasBlur from '../../hooks/useCanvasBlur';
import useEffectWithPrevDeps from '../../hooks/useEffectWithPrevDeps';
import useFlag from '../../hooks/useFlag';
import useKeyboardShortcutHint from '../../hooks/useKeyboardShortcutHint';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import useLongPress from '../../hooks/useLongPress';
import useMediaTransitionDeprecated from '../../hooks/useMediaTransitionDeprecated';
import useShowTransitionDeprecated from '../../hooks/useShowTransitionDeprecated';
import { useStreaming } from '../../hooks/useStreaming';
import useBackgroundMode from '../../hooks/window/useBackgroundMode';
import useStoryPreloader from './hooks/useStoryPreloader';
import useStoryProps from './hooks/useStoryProps';

import Avatar from '../common/Avatar';
import Composer from '../common/Composer';
import Icon from '../common/icons/Icon';
import Button from '../ui/Button';
import DropdownMenu from '../ui/DropdownMenu';
import MenuItem from '../ui/MenuItem';
import OptimizedVideo from '../ui/OptimizedVideo';
import Skeleton from '../ui/placeholder/Skeleton';
import Transition from '../ui/Transition';
import StoryCaption from './StoryCaption';
import StoryFooter from './StoryFooter';
import StoryProgress from './StoryProgress';
import TextStory from './TextStory';

import styles from './StoryViewer.module.scss';

interface OwnProps {
  peerId: string;
  storyId: number;
  dimensions: IDimensions;

  isDeleteModalOpen?: boolean;
  isPrivateStories?: boolean;
  isArchivedStories?: boolean;
  isSingleStory?: boolean;
  getIsAnimating: Signal<boolean>;
  onDelete: (story: ApiTypeStory) => void;
  onClose: NoneToVoidFunction;
}

interface StateProps {
  peer: ApiPeer;
  forwardSender?: ApiPeer;
  fromPeer?: ApiPeer;
  story?: ApiTypeStory;
  isMuted: boolean;
  orderedIds?: number[];
  shouldForcePause?: boolean;
  storyChangelogUserId?: string;
  isChatExist?: boolean;
  arePeerSettingsLoaded?: boolean;
  withHeaderAnimation?: boolean;
  isAccountFrozen?: boolean;
}

const VIDEO_MIN_READY_STATE = IS_SAFARI ? 4 : 3;

const NOTIFICATION_OPTIONS = {
  withNodes: true,
  withMarkdown: true,
  renderTextFilters: ['br', 'links'],
} satisfies AdvancedLangFnOptions;

function Story({
  peerId,
  storyId,
  peer,
  forwardSender,
  fromPeer,
  isMuted,
  isArchivedStories,
  isPrivateStories,
  story,
  orderedIds,
  isSingleStory,
  dimensions,
  shouldForcePause,
  storyChangelogUserId,
  isChatExist,
  arePeerSettingsLoaded,
  getIsAnimating,
  withHeaderAnimation,
  isAccountFrozen,
  onDelete,
  onClose,
}: OwnProps & StateProps) {
  const {
    viewStory,
    setStoryViewerMuted,
    openPreviousStory,
    openNextStory,
    loadPeerSkippedStories,
    openChat,
    showNotification,
    loadPeerSettings,
    fetchChat,
    loadStoryViews,
    toggleStoriesHidden,
  } = getActions();
  const serverTime = getServerTime();

  const lang = useLang();
  const closeLabel = useKeyboardShortcutHint(lang('Close'), 'closeStoryViewer');
  const { isMobile } = useAppLayout();
  const [isComposerHasFocus, markComposerHasFocus, unmarkComposerHasFocus] = useFlag(false);
  const [isStoryPlaybackRequested, playStory, pauseStory] = useFlag(false);
  const [isStoryPlaying, markStoryPlaying, unmarkStoryPlaying] = useFlag(false);
  const [isAppFocused, markAppFocused, unmarkAppFocused] = useFlag(true);
  const [isCaptionExpanded, expandCaption, foldCaption] = useFlag(false);
  const [isPausedBySpacebar, setIsPausedBySpacebar] = useState(false);
  const [isPausedByLongPress, markIsPausedByLongPress, unmarkIsPausedByLongPress] = useFlag(false);
  const [isDropdownMenuOpen, markDropdownMenuOpen, unmarkDropdownMenuOpen] = useFlag(false);
  const videoRef = useRef<HTMLVideoElement>();
  const {
    isDeletedStory,
    hasText,
    hasForwardInfo,
    thumbnail,
    previewBlobUrl,
    isVideo,
    noSound,
    fullMediaData,
    altMediaHash,
    altMediaData,
    hasFullData,
    hasThumb,
    canDownload,
    downloadMediaData,
  } = useStoryProps(story, isDropdownMenuOpen);

  const isLoadedStory = story && 'content' in story;
  const isChangelog = peerId === storyChangelogUserId;
  const isUserStory = isUserId(peerId);
  const isChatStory = !isUserStory;
  const isChannelStory = isChatStory && isChatChannel(peer as ApiChat);
  const isOut = isLoadedStory && story.isOut;
  const textStory = isLoadedStory ? story.textStory : undefined;
  const isUnsupportedStory = isLoadedStory && !textStory && Object.keys(story.content).length === 0;

  const forwardSenderTitle = forwardSender ? getPeerTitle(lang, forwardSender)
    : (isLoadedStory && story.forwardInfo?.fromName);

  const canPlayStory = Boolean(
    (hasFullData || isUnsupportedStory || textStory)
    && !shouldForcePause && isAppFocused && !isComposerHasFocus && !isCaptionExpanded
    && !isPausedBySpacebar && !isPausedByLongPress,
  );

  const duration = isLoadedStory && story.content.video?.duration
    ? story.content.video.duration
    : undefined;

  const shouldShowComposer = !(isOut && isUserStory) && !isChangelog && !isChannelStory && !isAccountFrozen
    && !(isLoadedStory && story.noReplies);
  const shouldShowFooter = isLoadedStory && !shouldShowComposer && (isOut || isChannelStory);
  const headerAnimation = isMobile && withHeaderAnimation ? 'slideFade' : 'none';

  const {
    shouldRender: shouldRenderSkeleton,
    transitionClassNames: skeletonTransitionClassNames,
  } = useShowTransitionDeprecated(!hasFullData && !isUnsupportedStory && !textStory);

  const {
    transitionClassNames: mediaTransitionClassNames,
  } = useShowTransitionDeprecated(Boolean(fullMediaData) && !isUnsupportedStory);

  const thumbRef = useCanvasBlur(thumbnail, !hasThumb);
  const previewTransitionClassNames = useMediaTransitionDeprecated(previewBlobUrl);

  const {
    shouldRender: shouldRenderComposer,
    transitionClassNames: composerAppearanceAnimationClassNames,
  } = useShowTransitionDeprecated(shouldShowComposer);

  const {
    shouldRender: shouldRenderCaptionBackdrop,
    transitionClassNames: captionBackdropTransitionClassNames,
  } = useShowTransitionDeprecated(hasText && isCaptionExpanded);

  const { transitionClassNames: appearanceAnimationClassNames } = useShowTransitionDeprecated(true);
  const {
    shouldRender: shouldRenderCaption,
    transitionClassNames: captionAppearanceAnimationClassNames,
  } = useShowTransitionDeprecated(hasText || hasForwardInfo);

  const isStreamingSupported = useStreaming(videoRef, fullMediaData, PRIMARY_VIDEO_MIME);

  useStoryPreloader(peerId, storyId);

  useEffect(() => {
    loadPeerSkippedStories({ peerId });
  }, [peerId]);

  // Fetching user privacy settings for use in Composer
  useEffect(() => {
    const canWrite = isUserId(peerId);
    if (!isChatExist && canWrite) {
      fetchChat({ chatId: peerId });
    }
  }, [isChatExist, peerId]);
  useEffect(() => {
    if (isChatExist && !arePeerSettingsLoaded) {
      loadPeerSettings({ peerId });
    }
  }, [arePeerSettingsLoaded, isChatExist, peerId]);

  const handlePauseStory = useLastCallback(() => {
    if (isVideo) {
      videoRef.current?.pause();
    }

    unmarkStoryPlaying();
    pauseStory();
  });

  const handlePlayStory = useLastCallback(() => {
    if (!canPlayStory) return;

    playStory();
    if (!isVideo) markStoryPlaying();
  });

  const handleLongPressStart = useLastCallback(() => {
    markIsPausedByLongPress();
  });
  const handleLongPressEnd = useLastCallback(() => {
    unmarkIsPausedByLongPress();
  });

  const handleDropdownMenuOpen = useLastCallback(() => {
    markDropdownMenuOpen();
    handlePauseStory();
  });

  const handleDropdownMenuClose = useLastCallback(() => {
    unmarkDropdownMenuOpen();
    handlePlayStory();
  });

  const {
    onMouseDown: handleLongPressMouseDown,
    onMouseUp: handleLongPressMouseUp,
    onMouseLeave: handleLongPressMouseLeave,
    onTouchStart: handleLongPressTouchStart,
    onTouchEnd: handleLongPressTouchEnd,
  } = useLongPress({
    onStart: handleLongPressStart,
    onEnd: handleLongPressEnd,
  });

  const isUnsupportedVideo = useUnsupportedMedia(
    videoRef,
    undefined,
    !isVideo || !fullMediaData || isStreamingSupported,
  );

  const hasAllData = fullMediaData && (!altMediaHash || altMediaData);
  const isStoryShown = Boolean(hasAllData || isUnsupportedVideo || isUnsupportedStory || textStory);
  useEffect(() => {
    // Start progress to the nest slide after media has been downloaded or it is unsupported
    if (hasAllData || isUnsupportedVideo || isUnsupportedStory || textStory) handlePlayStory();
  }, [hasAllData, isUnsupportedVideo, isUnsupportedStory, textStory]);

  useEffect(() => {
    // The author gets a viewed receipt once the story shows, so a story that fails to load stays unviewed
    if (storyId && isStoryShown) {
      viewStory({ peerId, storyId });
    }
  }, [storyId, peerId, isStoryShown]);

  useBackgroundMode(unmarkAppFocused, markAppFocused);

  useEffect(() => {
    if (!hasAllData) return;
    videoRef.current?.load();
  }, [hasAllData]);

  useEffect(() => {
    if (!isLoadedStory || isDeletedStory) return;

    if (!isOut && !isChannelStory) return;

    // Refresh counters each time
    loadStoryViews({ peerId, storyId });
  }, [isDeletedStory, isLoadedStory, peerId, storyId, isOut, isChannelStory]);

  useEffect(() => {
    if (
      shouldForcePause || !isAppFocused || isComposerHasFocus
      || isCaptionExpanded || isPausedBySpacebar || isPausedByLongPress
    ) {
      handlePauseStory();
    } else {
      handlePlayStory();
    }
  }, [
    handlePlayStory, isAppFocused, isCaptionExpanded, isComposerHasFocus,
    shouldForcePause, isPausedBySpacebar, isPausedByLongPress,
  ]);

  useEffect(() => {
    if (isComposerHasFocus || shouldForcePause || isCaptionExpanded) {
      return undefined;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (!getIsKeyboardShortcut(e, 'toggleStoryPlayback')) return;

      e.preventDefault();
      setIsPausedBySpacebar(!isPausedBySpacebar);
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCaptionExpanded, isComposerHasFocus, isPausedBySpacebar, shouldForcePause]);

  // Reset the state of `isPausedBySpacebar` when closing the caption, losing focus by composer or disable forced pause
  useEffectWithPrevDeps(([
    prevIsComposerHasFocus,
    prevIsCaptionExpanded,
    prevShouldForcePause,
    prevIsAppFocused,
    prevIsPausedByLongPress,
  ]) => {
    if (
      !isPausedBySpacebar || isCaptionExpanded || isComposerHasFocus
      || shouldForcePause || !isAppFocused || isPausedByLongPress
    ) {
      return;
    }

    if (
      prevIsCaptionExpanded !== isCaptionExpanded
      || prevIsComposerHasFocus !== isComposerHasFocus
      || prevShouldForcePause !== shouldForcePause
      || prevIsAppFocused !== isAppFocused
      || prevIsPausedByLongPress !== isPausedByLongPress
    ) {
      setIsPausedBySpacebar(false);
    }
  }, [isComposerHasFocus, isCaptionExpanded, shouldForcePause, isAppFocused, isPausedByLongPress, isPausedBySpacebar]);

  const handleOpenChat = useLastCallback(() => {
    onClose();
    openChat({ id: peerId });
  });

  const handleForwardPeerClick = useLastCallback(() => {
    onClose();
    openChat({ id: forwardSender!.id });
  });

  const handleFromPeerClick = useLastCallback(() => {
    onClose();
    openChat({ id: fromPeer!.id });
  });

  const handleOpenPrevStory = useLastCallback(() => {
    openPreviousStory();
  });

  const handleOpenNextStory = useLastCallback(() => {
    openNextStory();
  });

  const handleVideoStoryTimeUpdate = useLastCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.readyState >= VIDEO_MIN_READY_STATE) {
      markStoryPlaying();
    } else {
      unmarkStoryPlaying();
    }
    if (duration && round(video.currentTime, 2) >= round(duration, 2)) {
      handleOpenNextStory();
    }
  });

  const handleArrowKey = useLastCallback((e: KeyboardEvent) => {
    if (getIsKeyboardShortcut(e, 'previousStory')) {
      handleOpenPrevStory();
    } else if (getIsKeyboardShortcut(e, 'nextStory')) {
      handleOpenNextStory();
    } else {
      return false;
    }

    return true;
  });

  useEffect(() => {
    return !getIsAnimating() && !isComposerHasFocus ? captureKeyboardListeners({
      onRight: handleArrowKey,
      onLeft: handleArrowKey,
    }) : undefined;
  }, [getIsAnimating, isComposerHasFocus]);

  const handleDeleteStoryClick = useLastCallback(() => {
    onDelete(story!);
  });

  // Signal hides the stories of a contact or group from the ribbon (`hideStory`)
  const handleToggleHiddenClick = useLastCallback(() => {
    toggleStoriesHidden({ peerId, isHidden: !peer.areStoriesHidden });
  });

  const handleVolumeMuted = useLastCallback(() => {
    if (noSound) {
      showNotification({
        message: { key: 'StoryTooltipVideoHasNoSound', options: NOTIFICATION_OPTIONS },
      });
      return;
    }
    // Browser requires explicit user interaction to keep video playing after unmuting
    videoRef.current!.muted = !videoRef.current!.muted;
    setStoryViewerMuted({ isMuted: !isMuted });
  });

  const handleDownload = useLastCallback(() => {
    if (!downloadMediaData) return;
    download(downloadMediaData, `story-${peerId}-${storyId}.${isVideo ? 'mp4' : 'jpg'}`);
  });

  useEffect(() => {
    if (!isDeletedStory) return;

    showNotification({
      message: { key: 'StoryNotFound', options: NOTIFICATION_OPTIONS },
    });
  }, [isDeletedStory]);

  const MenuButton = useMemo(() => {
    return ({ onTrigger, isOpen }: { onTrigger: () => void; isOpen?: boolean }) => {
      return (
        <Button
          round
          ripple={!isMobile}
          size="tiny"
          color="translucent-white"
          onClick={onTrigger}
          className={buildClassName(styles.button, isOpen && 'active')}
          ariaLabel={lang('AriaLabelOpenMenu')}
          iconName="more"
        />
      );
    };
  }, [isMobile, lang]);

  function renderStoriesTabs() {
    return (
      <div className={styles.storyIndicators}>
        {(isSingleStory ? [storyId] : orderedIds ?? []).map((id) => (
          <StoryProgress
            key={`progress-${id}`}
            isActive={id === story?.id}
            isVideo={isVideo}
            isViewed={Boolean(story?.id && ((isPrivateStories || isArchivedStories) ? id > story?.id : id < story?.id))}
            isPaused={!isStoryPlaying}
            duration={duration}
            onImageComplete={handleOpenNextStory}
          />
        ))}
      </div>
    );
  }

  function renderSenderInfo() {
    return (
      <div className={styles.senderInfo}>
        <Avatar
          peer={peer}
          size="tiny"
          onClick={handleOpenChat}
        />
        <div className={styles.senderMeta}>
          <span onClick={handleOpenChat} className={styles.senderName}>
            {renderText(getPeerTitle(lang, peer) || '')}
          </span>
          <div className={styles.storyMetaRow}>
            {forwardSenderTitle && (
              <span
                className={buildClassName(
                  styles.storyMeta, styles.forwardHeader, forwardSender && styles.clickable,
                )}
                onClick={forwardSender ? handleForwardPeerClick : undefined}
              >
                <Icon name="loop" />
                <span className={styles.headerTitle}>
                  {renderText(forwardSenderTitle)}
                </span>
              </span>
            )}
            {fromPeer && (
              <span
                className={buildClassName(
                  styles.storyMeta, styles.fromPeer,
                )}
                onClick={handleFromPeerClick}
              >
                <Avatar peer={fromPeer} size="micro" />
                <span className={styles.headerTitle}>
                  {renderText(getPeerTitle(lang, fromPeer) || '')}
                </span>
              </span>
            )}
            {story && 'date' in story && (
              <span className={styles.storyMeta}>
                {formatRecentTimestamp(lang, secondsToDate(story.date), { anchorDate: secondsToDate(serverTime) })}
              </span>
            )}
            {isLoadedStory && story.isEdited && (
              <span className={styles.storyMeta}>{lang('StoryHeaderEdited')}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderSender() {
    return (
      <div className={styles.sender}>
        <Transition activeKey={Number(peerId)} name={headerAnimation} className={styles.senderInfoTransition}>
          {renderSenderInfo()}
        </Transition>

        <div className={styles.actions}>
          {isVideo && (
            <Button
              className={styles.button}
              round
              ripple={!isMobile}
              size="tiny"
              color="translucent-white"
              disabled={!hasFullData}
              onClick={handleVolumeMuted}
              ariaLabel={lang('AudioVolume')}
              iconName={(isMuted || noSound) ? 'speaker-muted-story' : 'speaker-story'}
            />
          )}
          <DropdownMenu
            className={styles.buttonMenu}
            trigger={MenuButton}
            positionX="right"
            onOpen={handleDropdownMenuOpen}
            onClose={handleDropdownMenuClose}
          >
            {canDownload && (
              <MenuItem icon="download" disabled={!downloadMediaData} onClick={handleDownload}>
                {lang('MediaDownload')}
              </MenuItem>
            )}
            {!isOut && (
              <MenuItem
                icon={peer.areStoriesHidden ? 'eye-outline' : 'eye-crossed-outline'}
                onClick={handleToggleHiddenClick}
              >
                {lang(peer.areStoriesHidden ? 'StoryMenuUnarchivePeer' : 'StoryMenuArchivePeer')}
              </MenuItem>
            )}
            {isOut && (
              <MenuItem
                icon="delete"
                destructive
                onClick={handleDeleteStoryClick}
              >
                {lang('Delete')}
              </MenuItem>
            )}
          </DropdownMenu>
          <Button
            className={buildClassName(styles.button, styles.closeButton)}
            round
            size="tiny"
            color="translucent-white"
            ariaLabel={closeLabel}
            onClick={onClose}
            iconName="close"
          />
        </div>
      </div>
    );
  }

  const inputPlaceholder = lang(isChatStory ? 'ReplyToGroupStory' : 'ReplyPrivately');

  return (
    <div
      className={buildClassName(styles.slideInner, 'component-theme-dark')}
      onMouseDown={handleLongPressMouseDown}
      onMouseUp={handleLongPressMouseUp}
      onMouseLeave={handleLongPressMouseLeave}
      onTouchStart={handleLongPressTouchStart}
      onTouchEnd={handleLongPressTouchEnd}
    >
      <div className={buildClassName(styles.storyHeader, appearanceAnimationClassNames)}>
        {renderStoriesTabs()}
        {renderSender()}
      </div>

      <div
        className={styles.mediaWrapper}
        style={`width: ${dimensions.width}px; height: ${dimensions.height}px`}
      >
        <canvas ref={thumbRef} className={styles.thumbnail} />
        {textStory && <TextStory key={`text-${storyId}`} textStory={textStory} />}
        {previewBlobUrl && (
          <img
            key={`preview-${storyId}`}
            src={previewBlobUrl}
            draggable={false}
            alt=""
            className={buildClassName(styles.media, styles.mediaPreview, previewTransitionClassNames)}
          />
        )}
        {shouldRenderSkeleton && (
          <Skeleton className={buildClassName(skeletonTransitionClassNames, styles.fullSize)} animation="pulse" />
        )}
        {!isVideo && fullMediaData && (
          <img
            src={fullMediaData}
            alt=""
            className={buildClassName(styles.media, mediaTransitionClassNames)}
            draggable={false}
          />
        )}
        {isVideo && fullMediaData && (
          <OptimizedVideo
            ref={videoRef}
            key={`video-${storyId}`}
            className={buildClassName(styles.media, mediaTransitionClassNames)}
            canPlay={isStoryPlaybackRequested}
            muted={isMuted}
            width={BASE_STORY_WIDTH}
            height={BASE_STORY_HEIGHT}
            draggable={false}
            playsInline
            disablePictureInPicture
            isPriority
            onPause={unmarkStoryPlaying}
            onWaiting={unmarkStoryPlaying}
            disableRemotePlayback
            onTimeUpdate={handleVideoStoryTimeUpdate}
          >
            <source src={fullMediaData} type={PRIMARY_VIDEO_MIME} width="720" />
            {altMediaData && <source src={altMediaData} type={SECONDARY_VIDEO_MIME} width="480" />}
          </OptimizedVideo>
        )}

        {isUnsupportedStory && (
          <div className={buildClassName(styles.media, styles.unsupportedMedia)}>
            <span>{lang('StoryUnsupported')}</span>
          </div>
        )}

        {!isPausedByLongPress && !isComposerHasFocus && (
          <>
            <button
              type="button"
              className={buildClassName(styles.navigate, styles.prev)}
              onClick={handleOpenPrevStory}
              aria-label={lang('AccDescrPrevious')}
            />
            <button
              type="button"
              className={buildClassName(styles.navigate, styles.next)}
              onClick={handleOpenNextStory}
              aria-label={lang('Next')}
            />
          </>
        )}
        {!isMobile && (
          <div className={styles.content}>
            <div className={styles.contentInner}>
              <Avatar
                peer={peer}
                withStory
                storyViewerMode="disabled"
              />
              <div className={styles.name}>{renderText(getPeerTitle(lang, peer) || '')}</div>
            </div>
          </div>
        )}
      </div>

      {shouldShowFooter && (
        <StoryFooter story={story} className={appearanceAnimationClassNames} />
      )}
      {shouldRenderCaptionBackdrop && (
        <div
          tabIndex={0}
          role="button"
          className={buildClassName(styles.captionBackdrop, captionBackdropTransitionClassNames)}
          onClick={() => foldCaption()}
          aria-label={lang('Close')}
        />
      )}
      {hasText && <div className={buildClassName(styles.captionGradient, captionAppearanceAnimationClassNames)} />}
      {shouldRenderCaption && (
        <StoryCaption
          key={`caption-${storyId}-${peerId}`}
          story={story as ApiStory}
          isExpanded={isCaptionExpanded}
          onExpand={expandCaption}
          onFold={foldCaption}
          className={captionAppearanceAnimationClassNames}
        />
      )}
      {shouldRenderComposer && (
        <Composer
          type="story"
          chatId={peerId}
          threadId={MAIN_THREAD_ID}
          storyId={storyId}
          isReady={!isOut}
          messageListType="thread"
          isMobile={getIsMobile()}
          editableInputCssSelector={EDITABLE_STORY_INPUT_CSS_SELECTOR}
          editableInputId={EDITABLE_STORY_INPUT_ID}
          inputId="story-input-text"
          className={buildClassName(styles.composer, composerAppearanceAnimationClassNames)}
          inputPlaceholder={inputPlaceholder}
          onFocus={markComposerHasFocus}
          onBlur={unmarkComposerHasFocus}
        />
      )}
    </div>
  );
}

export default memo(withGlobal<OwnProps>((global, {
  peerId,
  storyId,
  isDeleteModalOpen,
}): Complete<StateProps> => {
  const { appConfig } = global;
  const user = selectUser(global, peerId);
  const chat = selectChat(global, peerId);
  const userFullInfo = selectUserFullInfo(global, peerId);
  const tabState = selectTabState(global);
  const {
    storyViewer: {
      isMuted,
      viewModal,
      isPrivacyModalOpen,
      storyList,
    },
    forwardMessages: { storyId: forwardedStoryId },
    safeLinkModalUrl,
    mapModal,
    reportModal,
  } = tabState;
  const story = selectPeerStory(global, peerId, storyId);
  const isLoadedStory = story && 'content' in story;
  const shouldForcePause = Boolean(
    viewModal || forwardedStoryId || tabState.reactionPicker?.storyId || reportModal || isPrivacyModalOpen
    || isDeleteModalOpen || safeLinkModalUrl || mapModal,
  );

  const forwardInfo = isLoadedStory ? story.forwardInfo : undefined;
  const forwardSenderId = forwardInfo?.fromPeerId;
  const forwardSender = forwardSenderId ? selectPeer(global, forwardSenderId) : undefined;
  const withHeaderAnimation = selectPerformanceSettingsValue(global, 'mediaViewerAnimations');

  const fromPeer = isLoadedStory && story.fromId ? selectPeer(global, story.fromId) : undefined;
  const isAccountFrozen = selectIsCurrentUserFrozen(global);

  return {
    peer: (user || chat)!,
    forwardSender,
    fromPeer,
    story,
    orderedIds: storyList?.storyIdsByPeerId[peerId],
    isMuted,
    shouldForcePause,
    storyChangelogUserId: appConfig.storyChangelogUserId,
    isChatExist: Boolean(chat),
    arePeerSettingsLoaded: Boolean(userFullInfo?.settings),
    withHeaderAnimation,
    isAccountFrozen,
  };
})(Story));
