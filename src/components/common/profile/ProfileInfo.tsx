import { memo, useEffect, useMemo, useState } from '../../../lib/teact/teact';

import type {
  ApiChat,
  ApiPeerColorOption,
  ApiPeerPhotos,
  ApiPeerProfileColorSet,
  ApiPhoto,
  ApiUser,
  ApiUserFullInfo,
  ApiUserStatus,
} from '../../../api/types/index';
import type { AnimationLevel, ThemeKey } from '../../../types/index';
import { MediaViewerOrigin } from '../../../types/index';

import {
  getUserStatus, isUserOnline,
} from '../../../global/helpers/index';
import { getActions, withGlobal } from '../../../global/index';
import {
  selectChat,
  selectPeer,
  selectPeerAvatarPhoto,
  selectPeerHasProfileBackground,
  selectPeerPhotos,
  selectPeerProfileColor,
  selectTabState,
  selectTheme,
  selectUser,
  selectUserFullInfo,
  selectUserStatus,
} from '../../../global/selectors/index';
import { selectSharedSettings } from '../../../global/selectors/sharedState';
import { IS_TOUCH_ENV } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';
import buildStyle from '../../../util/buildStyle';
import { captureEvents, SwipeDirection } from '../../../util/captureEvents';
import { MEMO_EMPTY_ARRAY } from '../../../util/memo';
import { resolveTransitionName } from '../../../util/resolveTransitionName';
import { REM } from '../helpers/mediaDimensions.ts';

import { useVtn } from '../../../hooks/animations/useVtn';
import useIntervalForceUpdate from '../../../hooks/schedulers/useIntervalForceUpdate';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import usePreviousDeprecated from '../../../hooks/usePreviousDeprecated';
import useCustomEmoji from '../hooks/useCustomEmoji';
import usePhotosPreload from '../hooks/usePhotosPreload';

import Transition from '../../ui/Transition.tsx';
import Avatar from '../Avatar.tsx';
import FullNameTitle from '../FullNameTitle.tsx';
import ProfileMusicStrip from './ProfileMusicStrip';
import ProfilePhoto from './ProfilePhoto';
import RadialPatternBackground from './RadialPatternBackground.tsx';

import './ProfileInfo.scss';
import styles from './ProfileInfo.module.scss';

type OwnProps = {
  isExpanded?: boolean;
  isActive?: boolean;
  peerId: string;
  isForSettings?: boolean;
  canPlayVideo: boolean;
  onExpand?: NoneToVoidFunction;
};

type StateProps = {
  user?: ApiUser;
  userFullInfo?: ApiUserFullInfo;
  userStatus?: ApiUserStatus;
  chat?: ApiChat;
  mediaIndex?: number;
  avatarOwnerId?: string;
  animationLevel: AnimationLevel;
  profilePhotos?: ApiPeerPhotos;
  avatarPhoto?: ApiPhoto;
  profileColorOption?: ApiPeerColorOption<ApiPeerProfileColorSet>;
  theme: ThemeKey;
  isPlain?: boolean;
  hasAvatar?: boolean;
};

const LOAD_MORE_THRESHOLD = 3;
const MAX_PHOTO_DASH_COUNT = 30;
const STATUS_UPDATE_INTERVAL = 1000 * 60; // 1 min

const PATTERN_Y_SHIFT = 8 * REM;

const ProfileInfo = ({
  isExpanded,
  isActive,
  isForSettings,
  canPlayVideo,
  user,
  userFullInfo,
  userStatus,
  chat,
  mediaIndex,
  avatarOwnerId,
  animationLevel,
  profilePhotos,
  avatarPhoto,
  peerId,
  profileColorOption,
  theme,
  isPlain,
  hasAvatar,
  onExpand,
}: OwnProps & StateProps) => {
  const {
    openMediaViewer,
    openPrivacySettingsNoticeModal,
    loadMoreProfilePhotos,
  } = getActions();

  const savedMusic = userFullInfo?.savedMusic;

  const lang = useLang();

  useIntervalForceUpdate(user ? STATUS_UPDATE_INTERVAL : undefined);

  const { createVtnStyle } = useVtn();

  const photos = profilePhotos?.photos || MEMO_EMPTY_ARRAY;
  const prevMediaIndex = usePreviousDeprecated(mediaIndex);
  const prevAvatarOwnerId = usePreviousDeprecated(avatarOwnerId);
  const [hasSlideAnimation, setHasSlideAnimation] = useState(true);

  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const isFirst = photos.length <= 1 || currentPhotoIndex === 0;
  const isLast = photos.length <= 1 || currentPhotoIndex === photos.length - 1;

  const peer = user || chat;
  const { customEmoji: backgroundEmoji } = useCustomEmoji(
    peer?.profileColor?.backgroundEmojiId,
  );

  const profileColorSet = useMemo(() => {
    const colors = profileColorOption
      && (theme === 'dark' ? profileColorOption.darkColors : profileColorOption.colors);
    if (!colors) return undefined;

    // Why are they reversed on the server?
    return {
      bgColors: [...colors.bgColors].reverse(),
      storyColors: [...colors.storyColors].reverse(),
      buttonBaseColor: colors.bgColors[0],
    };
  }, [profileColorOption, theme]);

  const hasPatternBackground = profileColorSet?.bgColors || backgroundEmoji;

  useEffect(() => {
    if (photos.length - currentPhotoIndex <= LOAD_MORE_THRESHOLD) {
      loadMoreProfilePhotos({ peerId });
    }
  }, [currentPhotoIndex, peerId, photos.length]);

  // Set the current avatar photo to the last selected photo in Media Viewer after it is closed
  useEffect(() => {
    if (prevAvatarOwnerId && prevMediaIndex !== undefined && mediaIndex === undefined) {
      setHasSlideAnimation(false);
      setCurrentPhotoIndex(prevMediaIndex);
    }
  }, [mediaIndex, prevMediaIndex, prevAvatarOwnerId]);

  // Deleting the last profile photo may result in an error
  useEffect(() => {
    if (currentPhotoIndex > photos.length) {
      setHasSlideAnimation(false);
      setCurrentPhotoIndex(Math.max(0, photos.length - 1));
    }
  }, [currentPhotoIndex, photos.length]);

  // Reset photo index when collapsing
  useEffect(() => {
    if (!isExpanded) {
      setCurrentPhotoIndex(0);
    }
  }, [isExpanded]);

  usePhotosPreload(photos, currentPhotoIndex);

  const handleProfilePhotoClick = useLastCallback(() => {
    openMediaViewer({
      isAvatarView: true,
      chatId: peerId,
      mediaIndex: currentPhotoIndex,
      origin: isForSettings ? MediaViewerOrigin.SettingsAvatar : MediaViewerOrigin.ProfileAvatar,
    });
  });

  const selectPreviousMedia = useLastCallback(() => {
    if (isFirst) {
      return;
    }
    setHasSlideAnimation(true);
    setCurrentPhotoIndex(currentPhotoIndex - 1);
  });

  const selectNextMedia = useLastCallback(() => {
    if (isLast) {
      return;
    }
    setHasSlideAnimation(true);
    setCurrentPhotoIndex(currentPhotoIndex + 1);
  });

  const handleOpenGetReadDateModal = useLastCallback(() => {
    openPrivacySettingsNoticeModal({ chatId: chat!.id, isReadDate: false });
  });

  const handleMinimizedAvatarClick = useLastCallback(() => {
    if (isForSettings) {
      handleProfilePhotoClick();
      return;
    }

    if (hasAvatar) onExpand?.();
  });

  function handleSelectFallbackPhoto() {
    if (!isFirst) return;
    setHasSlideAnimation(true);
    setCurrentPhotoIndex(photos.length - 1);
  }

  // Swipe gestures
  useEffect(() => {
    const element = document.querySelector<HTMLDivElement>(`.${styles.photoWrapper}`);
    if (!element) {
      return undefined;
    }

    return captureEvents(element, {
      selectorToPreventScroll: '.Profile, .settings-content',
      onSwipe: IS_TOUCH_ENV ? (e, direction) => {
        if (direction === SwipeDirection.Right) {
          selectPreviousMedia();
          return true;
        } else if (direction === SwipeDirection.Left) {
          selectNextMedia();
          return true;
        }

        return false;
      } : undefined,
    });
  }, [selectNextMedia, selectPreviousMedia]);

  if (!user && !chat) {
    return undefined;
  }

  function renderPhotoTabs() {
    const totalPhotosLength = Math.max(photos.length, profilePhotos?.count || 0);
    if (!photos || totalPhotosLength <= 1) {
      return undefined;
    }

    const enumerator = Array.from({ length: Math.min(totalPhotosLength, MAX_PHOTO_DASH_COUNT) });
    const activeDashIndex = currentPhotoIndex >= MAX_PHOTO_DASH_COUNT ? MAX_PHOTO_DASH_COUNT - 1 : currentPhotoIndex;

    return (
      <div className={styles.photoDashes} style={createVtnStyle('photoDashes', true)}>
        {enumerator.map((_, i) => (
          <span className={buildClassName(styles.photoDash, i === activeDashIndex && styles.photoDash_current)} />
        ))}
      </div>
    );
  }

  function renderPhoto(isPhotoActive?: boolean) {
    const photo = photos.length > 0
      ? photos[currentPhotoIndex]
      : undefined;

    return (
      <ProfilePhoto
        key={currentPhotoIndex}
        user={user}
        chat={chat}
        photo={photo}
        theme={theme}
        canPlayVideo={Boolean(isPhotoActive && canPlayVideo)}
        className={buildClassName(isPhotoActive && styles.activeProfilePhoto)}
        style={isPhotoActive ? createVtnStyle('avatar', true) : undefined}
        onClick={handleProfilePhotoClick}
      />
    );
  }

  function renderStatus() {
    if (user) {
      return (
        <div
          className={buildClassName(
            styles.status,
            'status',
            isUserOnline(user, userStatus) && 'online',
          )}
          style={createVtnStyle('status', true)}
        >
          <span className={styles.userStatus} dir="auto">
            {getUserStatus(lang, user, userStatus)}
          </span>
          {userStatus?.isReadDateRestrictedByMe && (
            <span className={styles.getStatus} onClick={handleOpenGetReadDateModal}>
              <span>{lang('StatusHiddenShow')}</span>
            </span>
          )}
        </div>
      );
    }

    return (
      <span
        className={buildClassName(styles.status, 'status')}
        dir="auto"
        style={createVtnStyle('status', true)}
      >
        {lang('NMembers', {
          count: lang.number(chat!.membersCount ?? 0),
        }, { pluralValue: chat!.membersCount ?? 0 })}
      </span>
    );
  }

  return (
    <div
      className={buildClassName(
        'ProfileInfo',
        styles.root,
        !isExpanded && styles.minimized,
        isPlain && styles.plain,
        hasPatternBackground && styles.withBackground,
        savedMusic && styles.hasMusic,
      )}
      style={buildStyle(
        profileColorSet && `--profile-button-base: ${profileColorSet.buttonBaseColor}`,
        createVtnStyle('profileInfo', true),
      )}
      dir={lang.isRtl ? 'rtl' : undefined}
    >
      {hasPatternBackground && (
        <RadialPatternBackground
          backgroundColors={profileColorSet?.bgColors}
          patternIcon={backgroundEmoji}
          patternSize={16}
          withLinearGradient
          className={styles.radialPatternBackground}
          yPosition={PATTERN_Y_SHIFT}
        />
      )}
      {isExpanded && (
        <div className={styles.photoWrapper} style={createVtnStyle('photoWrapper', true)}>
          {renderPhotoTabs()}
          {!isForSettings && profilePhotos?.personalPhoto && (
            <div className={buildClassName(
              styles.fallbackPhoto,
              isFirst && styles.fallbackPhotoVisible,
            )}
            >
              <div className={styles.fallbackPhotoContents}>
                {lang(profilePhotos.personalPhoto.isVideo ? 'UserInfoCustomVideo' : 'UserInfoCustomPhoto')}
              </div>
            </div>
          )}
          {isForSettings && profilePhotos?.fallbackPhoto && (
            <div className={buildClassName(
              styles.fallbackPhoto,
              (isFirst || isLast) && styles.fallbackPhotoVisible,
            )}
            >
              <div className={styles.fallbackPhotoContents} onClick={handleSelectFallbackPhoto}>
                {!isLast && (
                  <Avatar
                    photo={profilePhotos.fallbackPhoto}
                    className={styles.fallbackPhotoAvatar}
                    size="mini"
                  />
                )}
                {lang(profilePhotos.fallbackPhoto.isVideo ? 'UserInfoPublicVideo' : 'UserInfoPublicPhoto')}
              </div>
            </div>
          )}
          <Transition
            activeKey={currentPhotoIndex}
            name={resolveTransitionName('slide', animationLevel, !hasSlideAnimation, lang.isRtl)}
          >
            {renderPhoto}
          </Transition>

          {!isFirst && (
            <button
              type="button"
              dir={lang.isRtl ? 'rtl' : undefined}
              className={buildClassName(styles.navigation, styles.navigation_prev)}
              aria-label={lang('AccDescrPrevious')}
              onClick={selectPreviousMedia}
            />
          )}
          {!isLast && (
            <button
              type="button"
              dir={lang.isRtl ? 'rtl' : undefined}
              className={buildClassName(styles.navigation, styles.navigation_next)}
              aria-label={lang('Next')}
              onClick={selectNextMedia}
            />
          )}
        </div>
      )}
      {!isExpanded && (
        <Avatar
          withStory
          storyColors={profileColorSet?.storyColors}
          className={styles.standaloneAvatar}
          key={peer?.id}
          size="jumbo"
          peer={peer}
          photo={avatarPhoto}
          withVideo={canPlayVideo}
          loopIndefinitely
          style={createVtnStyle('avatar', true)}
          storyCircleStyle={createVtnStyle('avatarStoryCircle', true)}
          onClick={hasAvatar ? handleMinimizedAvatarClick : undefined}
        />
      )}

      <div
        className={styles.info}
        dir={lang.isRtl ? 'rtl' : 'auto'}
        style={createVtnStyle('info', true)}
      >
        {(user || chat) && (
          <FullNameTitle
            className={styles.title}
            style={createVtnStyle('title', true)}
            peer={(user || chat)!}
            canCopyTitle
            isScrolling
            isScrollingPaused={!isActive}
          />
        )}
        {renderStatus()}
      </div>
      {savedMusic && (
        <ProfileMusicStrip
          audio={savedMusic}
          peerId={peerId}
          isOverlay={isExpanded || !isPlain}
          className={styles.musicBand}
          style={createVtnStyle('music', true)}
        />
      )}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { peerId }): Complete<StateProps> => {
    const peer = selectPeer(global, peerId);
    const user = selectUser(global, peerId);
    const userFullInfo = user ? selectUserFullInfo(global, peerId) : undefined;
    const userStatus = selectUserStatus(global, peerId);
    const chat = selectChat(global, peerId);
    const profilePhotos = selectPeerPhotos(global, peerId);
    const avatarPhoto = selectPeerAvatarPhoto(global, peerId);
    const { mediaIndex, chatId: avatarOwnerId } = selectTabState(global).mediaViewer;
    const { animationLevel } = selectSharedSettings(global);

    const profileColor = peer && selectPeerProfileColor(global, peer);
    const theme = selectTheme(global);

    const hasBackground = selectPeerHasProfileBackground(global, peerId);
    const hasAvatar = Boolean(peer?.avatarPhotoId);

    return {
      user,
      userFullInfo,
      userStatus,
      chat,
      mediaIndex,
      avatarOwnerId,
      animationLevel,
      profilePhotos,
      avatarPhoto,
      profileColorOption: profileColor,
      theme,
      isPlain: !hasBackground,
      hasAvatar,
    };
  },
)(ProfileInfo));
