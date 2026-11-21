import type { TeactNode } from '@teact';
import { memo, useEffect, useMemo, useRef, useState } from '@teact';
import { getActions, getGlobal, withGlobal } from '../../global';

import type {
  ApiChat,
  ApiChatFullInfo,
  ApiChatMember,
  ApiMessage,
  ApiStoryAlbum,
  ApiTypeStory,
  ApiUser,
  ApiUserFullInfo,
  ApiUserStatus,
} from '../../api/types';
import type { ProfileCollectionKey } from '../../global/selectors/stories';
import type { TabState } from '../../global/types';
import type { AnimationLevel, ProfileState, ProfileTabType,
  SharedMediaType, ThemeKey, ThreadId } from '../../types';
import type { RegularLangKey } from '../../types/language';
import { MAIN_THREAD_ID } from '../../api/types';
import { LoadMoreDirection, MediaViewerOrigin, NewChatMembersProgress } from '../../types';

import {
  MEMBERS_SLICE, PROFILE_POLLS_SLICE, PROFILE_SENSITIVE_AREA, SHARED_MEDIA_SLICE, SLIDE_TRANSITION_DURATION,
} from '../../config';
import {
  getHasAdminRight,
  getIsDownloading,
  getMessageDocument,
  getMessageHtmlId,
  getRichMediaMessage,
  isChatBasicGroup,
  isChatGroup,
  isUserRightBanned,
  parseSharedMediaKey,
  type SharedMediaKey,
} from '../../global/helpers';
import {
  selectActiveDownloads,
  selectCanBanUsers,
  selectCanEditRank,
  selectChat,
  selectChatFullInfo,
  selectChatMessages,
  selectCurrentSharedMediaSearch,
  selectIsChatRestricted,
  selectIsCurrentUserFrozen,
  selectIsRightColumnShown,
  selectPeerStories,
  selectPerformanceSettingsValue,
  selectTabState,
  selectTheme,
  selectUser,
  selectUserCommonChats,
  selectUserFullInfo,
} from '../../global/selectors';
import { selectMessageDownloadableMedia } from '../../global/selectors/media';
import { selectSharedSettings } from '../../global/selectors/sharedState';
import { selectActiveStoriesCollectionId } from '../../global/selectors/stories';
import {
  VTT_RIGHT_PROFILE_COLLAPSE,
  VTT_RIGHT_PROFILE_EXPAND,
} from '../../util/animations/viewTransitionTypes.ts';
import { IS_TOUCH_ENV } from '../../util/browser/windowEnvironment';
import buildClassName from '../../util/buildClassName';
import { captureEvents, SwipeDirection } from '../../util/captureEvents';
import { getGridCornerClassName } from '../../util/gridCorners';
import { buildCollectionByKey } from '../../util/iteratees.ts';
import { resolveTransitionName } from '../../util/resolveTransitionName.ts';
import { getSenderName } from '../left/search/helpers/getSenderName';

import { useViewTransition } from '../../hooks/animations/useViewTransition';
import { useVtn } from '../../hooks/animations/useVtn.ts';
import useTopOverscroll from '../../hooks/scroll/useTopOverscroll.tsx';
import useFlag from '../../hooks/useFlag';
import { useIntersectionObserver } from '../../hooks/useIntersectionObserver';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import useMediaTransition from '../../hooks/useMediaTransition';
import useSyncEffectWithPrevDeps from '../../hooks/useSyncEffectWithPrevDeps.ts';
import useAsyncRendering from './hooks/useAsyncRendering';
import useProfileState from './hooks/useProfileState';
import useProfileViewportIds from './hooks/useProfileViewportIds';
import useTransitionFixes from './hooks/useTransitionFixes';

import Audio from '../common/Audio';
import Document from '../common/Document';
import GroupChatInfo from '../common/GroupChatInfo';
import Media from '../common/Media';
import NothingFound from '../common/NothingFound';
import PrivateChatInfo from '../common/PrivateChatInfo';
import ChatExtra from '../common/profile/ChatExtra';
import ProfileInfo from '../common/profile/ProfileInfo.tsx';
import ProfilePoll from '../common/ProfilePoll';
import WebLink from '../common/WebLink';
import Island from '../gili/layout/Island';
import Surface from '../gili/layout/Surface';
import MediaStory from '../story/MediaStory';
import FloatingActionButton from '../ui/FloatingActionButton';
import InfiniteScroll from '../ui/InfiniteScroll';
import ListItem, { type MenuItemContextAction } from '../ui/ListItem';
import Spinner from '../ui/Spinner';
import TabList, { type TabWithProperties } from '../ui/TabList';
import Transition from '../ui/Transition';
import StoryAlbumList from './stories/StoryAlbumList';

import styles from './Profile.module.scss';

type OwnProps = {
  chatId: string;
  threadId?: ThreadId;
  profileState: ProfileState;
  isMobile?: boolean;
  isActive: boolean;
  onProfileStateChange: (state: ProfileState) => void;
  onProfileExpandedChange?: (isExpanded: boolean) => void;
};

type StateProps = {
  theme: ThemeKey;
  currentUserId?: string;
  messagesById?: Record<number, ApiMessage>;
  foundIds?: number[];
  mediaSearchType?: SharedMediaType;
  hasCommonChatsTab?: boolean;
  hasStoriesTab?: boolean;
  hasMembersTab?: boolean;
  areProfileTabsKnown?: boolean;
  storyAlbums?: ApiStoryAlbum[];
  areMembersHidden?: boolean;
  canAddMembers?: boolean;
  canDeleteMembers?: boolean;
  members?: ApiChatMember[];
  adminMembersById?: Record<string, ApiChatMember>;
  commonChatIds?: string[];
  storyIds?: number[];
  pinnedStoryIds?: number[];
  archiveStoryIds?: number[];
  storyByIds?: Record<number, ApiTypeStory>;
  selectedStoryAlbumId: ProfileCollectionKey;
  chatsById: Record<string, ApiChat>;
  usersById: Record<string, ApiUser>;
  userStatusesById: Record<string, ApiUserStatus>;
  isRightColumnShown: boolean;
  isRestricted?: boolean;
  activeDownloads: TabState['activeDownloads'];
  isChatProtected?: boolean;
  chatInfo: TabState['chatInfo'];
  animationLevel: AnimationLevel;
  shouldWarnAboutFiles?: boolean;
  isSavedMessages?: boolean;
  isSynced?: boolean;
  hasAvatar?: boolean;
  peerFullInfo?: ApiUserFullInfo | ApiChatFullInfo;
  canAutoPlayGifs?: boolean;
};

type LocalTabProps = {
  type: ProfileTabType;
  key: RegularLangKey;
};

type TabWithPropertiesAndType = TabWithProperties & {
  type: ProfileTabType;
};

const TABS: LocalTabProps[] = [
  { type: 'media', key: 'ProfileTabMedia' },
  { type: 'documents', key: 'ProfileTabFiles' },
  { type: 'links', key: 'ProfileTabLinks' },
  { type: 'audio', key: 'ProfileTabMusic' },
  { type: 'gif', key: 'ProfileTabGifs' },
];

const CONTENT_PANEL_SHOW_DELAY = 300;
const HIDDEN_RENDER_DELAY = 1000;
const INTERSECTION_THROTTLE = 500;
const NESTED_CONTENT_SELECTOR = (
  `.Transition > .Transition_slide-active > .Transition > .Transition_slide-active > .${styles.content}`
);

const SHARED_MEDIA_TYPES = new Set<StringAutocomplete<SharedMediaType>>([
  'media', 'documents', 'links', 'audio', 'voice', 'gif', 'polls',
]);
const NON_ISLAND_TABS = new Set<ProfileTabType>([
  'media', 'gif', 'stories', 'storiesArchive', 'polls',
]);
const MESSAGE_BASED_TABS = new Set<ProfileTabType>([
  'media', 'gif', 'documents', 'links', 'audio', 'voice', 'polls',
]);
const VIRTUALIZED_TABS = new Set<ProfileTabType>([
  'media', 'gif', 'documents', 'links', 'audio',
  'voice', 'polls', 'members', 'commonChats', 'stories', 'storiesArchive',
]);

const CONTENT_LIST_CLASS: Record<string, string> = {
  media: styles.mediaList,
  documents: styles.documentsList,
  links: styles.linksList,
  audio: styles.audioList,
  voice: styles.voiceList,
  polls: styles.pollsList,
  gif: styles.gifList,
  stories: styles.storiesList,
  storiesArchive: styles.storiesArchiveList,
  members: styles.membersList,
  commonChats: styles.commonChatsList,
};

const Profile = ({
  chatId,
  isActive,
  threadId,
  chatInfo,
  profileState,
  theme,
  currentUserId,
  messagesById,
  foundIds,
  storyIds,
  pinnedStoryIds,
  archiveStoryIds,
  storyByIds,
  selectedStoryAlbumId,
  mediaSearchType,
  hasCommonChatsTab,
  hasStoriesTab,
  hasMembersTab,
  areProfileTabsKnown,
  storyAlbums,
  areMembersHidden,
  canAddMembers,
  canDeleteMembers,
  commonChatIds,
  members,
  adminMembersById,
  usersById,
  userStatusesById,
  chatsById,
  isRightColumnShown,
  isRestricted,
  activeDownloads,
  isChatProtected,
  animationLevel,
  shouldWarnAboutFiles,
  isSavedMessages,
  isSynced,
  hasAvatar,
  peerFullInfo,
  canAutoPlayGifs,
  onProfileStateChange,
  onProfileExpandedChange,
}: OwnProps & StateProps) => {
  const {
    setSharedMediaSearchType,
    loadCommonChats,
    openChat,
    searchSharedMediaMessages,
    openMediaViewer,
    openAudioPlayer,
    focusMessage,
    setNewChatMembersDialogState,
    loadPeerProfileStories,
    loadStoriesArchive,
    loadStoryAlbums,
    resetSelectedStoryAlbum,
    changeProfileTab,
    openEditRankModal,
    openDeleteMemberModal,
  } = getActions();

  const containerRef = useRef<HTMLDivElement>();
  const transitionRef = useRef<HTMLDivElement>();

  const shouldSkipTransitionRef = useRef(false);

  const lang = useLang();

  const isClosed = !chatInfo.isOpen;
  const { profileTab, forceScrollProfileTab, isOwnProfile } = chatInfo;

  const profileId = chatId;
  const [isProfileExpanded, expandProfile, collapseProfile] = useFlag();

  useEffect(() => {
    onProfileExpandedChange?.(isProfileExpanded);
  }, [isProfileExpanded, onProfileExpandedChange]);

  const tabs = useMemo(() => {
    const arr: LocalTabProps[] = [];
    if (hasStoriesTab) {
      arr.push({ type: 'stories', key: 'ProfileTabStories' });
    }

    if (hasStoriesTab && isOwnProfile) {
      arr.push({ type: 'storiesArchive', key: 'ProfileTabStoriesArchive' });
    }

    if (hasMembersTab && !isOwnProfile) {
      arr.push({ type: 'members', key: 'ProfileTabMembers' });
    }

    if (!isOwnProfile) {
      arr.push(...TABS);
    }

    if (!isOwnProfile) {
      arr.push({ type: 'voice', key: 'ProfileTabVoice' });
    }

    if (!isOwnProfile) {
      arr.push({ type: 'polls', key: 'ProfileTabPolls' });
    }

    if (hasCommonChatsTab && !isOwnProfile) {
      arr.push({ type: 'commonChats', key: 'ProfileTabSharedGroups' });
    }

    // Fallback to prevent errors in edge cases
    // TODO: Handle no tabs case, skip shared media block
    if (!arr.length) {
      arr.push(TABS[0]);
    }

    return arr.map((tab) => ({
      type: tab.type,
      title: lang(tab.key),
    } satisfies TabWithPropertiesAndType));
  }, [
    hasStoriesTab, hasMembersTab, hasCommonChatsTab, lang, isOwnProfile,
  ]);

  const [allowAutoScrollToTabs, startAutoScrollToTabsIfNeeded, stopAutoScrollToTabs] = useFlag(false);

  const setActiveTab = useLastCallback((type: ProfileTabType) => {
    if (isClosed) return;
    changeProfileTab({ profileTab: type });
    setSharedMediaSearchType({ mediaType: SHARED_MEDIA_TYPES.has(type) ? type as SharedMediaType : undefined });
  });

  const isSharedMediaReady = Boolean(profileTab || areProfileTabsKnown);
  const { ref: sharedMediaTabsRef } = useMediaTransition({ hasMediaData: isSharedMediaReady });
  const { ref: sharedMediaRef } = useMediaTransition({ hasMediaData: isSharedMediaReady });

  useEffect(() => {
    if (isClosed) return;
    if (profileTab) {
      if (forceScrollProfileTab) {
        changeProfileTab({ profileTab, shouldScrollTo: undefined });
      }
      return;
    }

    if (!areProfileTabsKnown) return;

    setActiveTab(tabs[0].type); // Set default tab
  }, [isClosed, profileTab, tabs, forceScrollProfileTab, areProfileTabsKnown]);

  const handleSwitchTab = useLastCallback((index: number) => {
    startAutoScrollToTabsIfNeeded();
    setActiveTab(tabs[index].type);
  });

  useEffect(() => {
    resetSelectedStoryAlbum();
  }, [chatId]);

  useEffect(() => {
    if (hasStoriesTab && isSynced) {
      loadStoryAlbums({ peerId: chatId });
    }
  }, [chatId, hasStoriesTab, isSynced]);

  const { startViewTransition } = useViewTransition();
  const { createVtnStyle } = useVtn();

  const membersById = useMemo(() => {
    return members && buildCollectionByKey(members, 'userId');
  }, [members]);

  const activeTabIndex = useMemo(() => {
    const index = tabs.findIndex(({ type }) => type === profileTab);
    return index === -1 ? 0 : index;
  }, [profileTab, tabs]);

  // Reset skip transition flag from previous render
  if (shouldSkipTransitionRef.current) {
    shouldSkipTransitionRef.current = false;
  }

  useSyncEffectWithPrevDeps(([prevProfileTab, prevActiveTabIndex]) => {
    if (prevProfileTab === profileTab && prevActiveTabIndex !== activeTabIndex) {
      shouldSkipTransitionRef.current = true;
    }
  }, [profileTab, activeTabIndex]);

  const tabType = tabs[activeTabIndex].type;
  const handleLoadCommonChats = useLastCallback(() => {
    if (!isSynced) return;
    loadCommonChats({ userId: chatId });
  });
  const handleLoadPeerStories = useLastCallback(({ offsetId }: { offsetId: number }) => {
    loadPeerProfileStories({ peerId: chatId, offsetId });
  });
  const handleLoadStoriesArchive = useLastCallback(({ offsetId }: { offsetId: number }) => {
    loadStoriesArchive({ peerId: chatId, offsetId });
  });

  const [scrollToTopKey, setScrollToTopKey] = useState(0);
  const handleScrollToTop = useLastCallback(() => {
    setScrollToTopKey(scrollToTopKey + 1);
  });

  const [resultType, viewportIds, getMore] = useProfileViewportIds({
    searchMessages: searchSharedMediaMessages,
    loadStories: handleLoadPeerStories,
    loadStoriesArchive: handleLoadStoriesArchive,
    loadCommonChats: handleLoadCommonChats,
    tabType,
    mediaSearchType,
    groupChatMembers: members,
    commonChatIds,
    usersById,
    userStatusesById,
    chatsById,
    chatMessages: messagesById,
    foundIds,
    threadId,
    storyIds,
    pinnedStoryIds,
    archiveStoryIds,
    scrollToTopKey,
  });

  const shouldWrapInIsland = !NON_ISLAND_TABS.has(resultType);
  const isVirtualized = VIRTUALIZED_TABS.has(resultType);

  useEffect(() => {
    if (getMore && !viewportIds && isSynced) {
      getMore({ direction: LoadMoreDirection.Backwards });
    }
  }, [getMore, viewportIds, resultType, mediaSearchType, isSynced]);

  const shouldRenderProfileInfo = !isSavedMessages;

  const isFirstTab = tabs[0].type === resultType;
  const activeKey = tabs.findIndex(({ type }) => type === resultType);

  const [isStoryAlbumsShowed, markStoryAlbumsShowed, unmarkStoryAlbums] = useFlag(false);

  const hasStoryAlbums = storyAlbums && storyAlbums.length > 0;
  const isStoriesResult = resultType === 'stories';
  const shouldShowContentPanel = isStoriesResult && hasStoryAlbums;

  useEffect(() => {
    const timers: number[] = [];
    if (hasStoryAlbums) {
      timers.push(setTimeout(markStoryAlbumsShowed, CONTENT_PANEL_SHOW_DELAY));
    } else {
      unmarkStoryAlbums();
    }

    return () => timers.forEach(clearTimeout);
  }, [hasStoryAlbums, markStoryAlbumsShowed]);

  const handleStopAutoScrollToTabs = useLastCallback(() => {
    stopAutoScrollToTabs();
  });

  const handleExpandProfile = useLastCallback(() => {
    if (isProfileExpanded) return;
    startViewTransition(VTT_RIGHT_PROFILE_EXPAND, () => {
      expandProfile();
    });
  });

  const handleCollapseProfile = useLastCallback(() => {
    if (!isProfileExpanded) return;
    startViewTransition(VTT_RIGHT_PROFILE_COLLAPSE, () => {
      collapseProfile();
    });
  });

  const { handleScroll } = useProfileState({
    containerRef,
    tabType: resultType,
    profileState,
    hasProfileInfo: !isSavedMessages,
    forceScrollProfileTab,
    allowAutoScrollToTabs,
    onProfileStateChange,
    handleStopAutoScrollToTabs,
    onScrollToTop: handleScrollToTop,
  });

  useTransitionFixes(containerRef);

  const { observe: observeIntersectionForMedia } = useIntersectionObserver({
    rootRef: containerRef,
    throttleMs: INTERSECTION_THROTTLE,
  });

  const handleNewMemberDialogOpen = useLastCallback(() => {
    setNewChatMembersDialogState({ newChatMembersProgress: NewChatMembersProgress.InProgress });
  });

  const handleSelectMedia = useLastCallback((messageId: number, messageChatId: string, mediaIndex?: number) => {
    openMediaViewer({
      chatId: profileId,
      threadId: MAIN_THREAD_ID,
      messageId,
      mediaIndex,
      origin: MediaViewerOrigin.SharedMedia,
    });
  });

  const handlePlayAudio = useLastCallback((messageId: number, messageChatId: string, documentId?: string) => {
    openAudioPlayer({
      item: {
        type: 'message', chatId: messageChatId, threadId: threadId ?? MAIN_THREAD_ID, messageId, documentId,
      },
    });
  });

  const handleMemberClick = useLastCallback((id: string) => {
    openChat({ id });
  });

  const handleMessageFocus = useLastCallback((message: ApiMessage) => {
    focusMessage({ chatId: message.chatId, messageId: message.id });
  });

  const getMessageContextActions = useLastCallback((message: ApiMessage): MenuItemContextAction[] => {
    return [{
      title: lang('FocusMessage'),
      icon: 'show-message',
      handler: () => {
        handleMessageFocus(message);
      },
    }];
  });

  useTopOverscroll({
    containerRef,
    onOverscroll: handleExpandProfile,
    onReset: handleCollapseProfile,
    isOverscrolled: isProfileExpanded,
    isDisabled: !hasAvatar || !shouldRenderProfileInfo,
  });

  useEffect(() => {
    if (!transitionRef.current || !IS_TOUCH_ENV) {
      return undefined;
    }

    return captureEvents(transitionRef.current, {
      selectorToPreventScroll: '.Profile',
      onSwipe: (e, direction) => {
        if (direction === SwipeDirection.Left) {
          const nextIndex = Math.min(activeTabIndex + 1, tabs.length - 1);
          setActiveTab(tabs[nextIndex].type);
          return true;
        } else if (direction === SwipeDirection.Right) {
          const nextIndex = Math.max(0, activeTabIndex - 1);
          setActiveTab(tabs[nextIndex].type);
          return true;
        }

        return false;
      },
    });
  }, [activeTabIndex, tabs]);

  let renderingDelay;
  // @optimization Used to unparallelize rendering of message list and profile media
  if (isFirstTab) {
    renderingDelay = !isRightColumnShown ? HIDDEN_RENDER_DELAY : 0;
    // @optimization Used to delay first render of secondary tabs while animating
  } else if (!viewportIds) {
    renderingDelay = SLIDE_TRANSITION_DURATION;
  }

  const canRenderContent = useAsyncRendering([chatId, threadId, resultType,
    activeTabIndex, selectedStoryAlbumId], renderingDelay);

  function getMemberContextAction(memberId: string): MenuItemContextAction[] | undefined {
    const global = getGlobal();
    const member = adminMembersById?.[memberId] || membersById?.[memberId];
    const canEditRank = member && selectCanEditRank(global, {
      chatId,
      userId: memberId,
      isAdmin: member?.isAdmin,
      isOwner: member?.isOwner,
    });

    const actions: MenuItemContextAction[] = [];

    if (memberId !== currentUserId && canDeleteMembers) {
      actions.push({
        title: lang('ContextRemoveFromGroup'),
        icon: 'stop',
        handler: () => {
          openDeleteMemberModal({ chatId, peerId: memberId });
        },
      });
    }

    if (canEditRank) {
      actions.push({
        title: lang('MemberContextEditRank'),
        icon: 'tag',
        handler: () => {
          openEditRankModal({
            chatId,
            userId: memberId,
            isAdmin: member?.isAdmin,
            isOwner: member?.isOwner,
            rank: member?.rank,
          });
        },
      });
    }

    if (actions.length === 0) {
      return undefined;
    }

    return actions;
  }

  const shouldWrapInInfiniteScroll = shouldWrapInIsland;
  const shouldUseTransitionForContent = resultType === 'stories';

  function wrapInInfiniteScroll(content: TeactNode) {
    const listClass = CONTENT_LIST_CLASS[resultType];
    const itemSelector = shouldUseTransitionForContent
      ? `.${listClass} > .Transition_slide-active .${listClass} > .scroll-item`
      : `.${listClass} > .scroll-item`;

    return (
      <InfiniteScroll
        items={canRenderContent ? viewportIds : undefined}
        itemSelector={itemSelector}
        preloadBackwards={canRenderContent ? getPreloadSlice(resultType) : 0}
        sensitiveArea={PROFILE_SENSITIVE_AREA}
        scrollContainerClosest=".Profile"
        noScrollRestore={!isVirtualized}
        noScrollRestoreOnTop
        noFastList
        onLoadMore={getMore}
      >
        {content}
      </InfiniteScroll>
    );
  }

  function wrapInIsland(content: TeactNode, className?: string) {
    if (!shouldWrapInIsland) return content;

    const inner = shouldWrapInInfiniteScroll ? wrapInInfiniteScroll(content) : content;

    return (
      <div className={styles.sharedMediaIslandContainer}>
        <Island className={buildClassName(styles.sharedMediaIsland, 'custom-scroll', className)}>
          {inner}
        </Island>
      </div>
    );
  }

  function renderContent() {
    const needsMessages = MESSAGE_BASED_TABS.has(resultType);
    const noContent = !viewportIds || !canRenderContent || (needsMessages && !messagesById);
    const noSpinner = isFirstTab && !canRenderContent;

    if (shouldWrapInIsland) {
      return renderSpinnerOrContent(noContent, noSpinner);
    }

    return (
      <div className={styles.sharedMediaIslandContainer}>
        {renderCategories()}
        {wrapInInfiniteScroll(renderSpinnerOrContent(noContent, noSpinner))}
      </div>
    );
  }

  function renderCategories() {
    if (resultType === 'stories') {
      return (
        <div
          className={buildClassName(
            styles.contentCategoriesPanel,
            !shouldShowContentPanel && styles.hiddenPanel,
            isStoryAlbumsShowed && styles.noTransition,
          )}
        >
          <StoryAlbumList peerId={chatId} />
        </div>
      );
    }

    return undefined;
  }

  function getViewportMediaItems() {
    return (viewportIds as SharedMediaKey[]).flatMap((key) => {
      const { messageId, mediaIndex } = parseSharedMediaKey(key);
      const sourceMessage = messagesById?.[messageId];
      const message = sourceMessage && mediaIndex !== undefined
        ? getRichMediaMessage(sourceMessage, mediaIndex)
        : sourceMessage;

      return message ? [{ key, message, mediaIndex }] : [];
    });
  }

  function renderSpinnerOrContentBase(noContent: boolean, noSpinner: boolean) {
    if (noContent) {
      const forceRenderHiddenMembers = Boolean(resultType === 'members' && areMembersHidden);

      return (
        <div
          className={buildClassName(styles.content, styles.emptyList)}
        >
          {!noSpinner && !forceRenderHiddenMembers && <Spinner />}
          {forceRenderHiddenMembers && <NothingFound text={lang('ChatMemberListNoAccess')} />}
        </div>
      );
    }

    const isViewportIdsEmpty = viewportIds && !viewportIds?.length;

    if (isViewportIdsEmpty) {
      let text: string;

      switch (resultType) {
        case 'members':
          text = areMembersHidden ? lang('ChatMemberListNoAccess') : lang('NoMembersFound');
          break;
        case 'commonChats':
          text = lang('NoGroupsInCommon');
          break;
        case 'documents':
          text = lang('MediaFileEmpty');
          break;
        case 'links':
          text = lang('MediaLinkEmpty');
          break;
        case 'audio':
          text = lang('MediaSongEmpty');
          break;
        case 'voice':
          text = lang('MediaAudioEmpty');
          break;
        case 'polls':
          text = lang('ProfilePollsEmpty');
          break;
        case 'stories':
          text = lang('StoryListSavedEmptyStateTitle');
          break;
        case 'storiesArchive':
          text = lang('StoryListArchivedEmptyStateTitle');
          break;
        case 'gif':
          text = lang('MediaGifEmpty');
          break;
        default:
          text = lang('SharedMediaEmptyTitle');
      }

      return (
        <div className={buildClassName(styles.content, styles.emptyList)}>
          <NothingFound text={text} />
        </div>
      );
    }

    if (!messagesById) {
      // A TypeScript assertion, should never be really reached
      return;
    }

    const noTransition = resultType === 'stories' ? isStoryAlbumsShowed : false;
    const contentEl = (
      <div
        className={buildClassName(
          styles.content,
          CONTENT_LIST_CLASS[resultType],
          shouldShowContentPanel && styles.showContentPanel,
          noTransition && styles.noTransition,
        )}
        dir={lang.isRtl && (resultType === 'media' || resultType === 'gif') ? 'rtl' : undefined}
        teactFastList
      >
        {resultType === 'media' || resultType === 'gif' ? (
          getViewportMediaItems().map(({ key, message, mediaIndex }, i, items) => (
            <Media
              key={key}
              message={message}
              mediaIndex={mediaIndex}
              className={getGridCornerClassName(i, items.length)}
              isProtected={isChatProtected || message.isProtected}
              canAutoPlay={canAutoPlayGifs}
              observeIntersection={observeIntersectionForMedia}
              onClick={handleSelectMedia}
              contextActions={getMessageContextActions(message)}
            />
          ))
        ) : (resultType === 'stories' || resultType === 'storiesArchive') ? (
          (viewportIds as number[]).filter((id) => Boolean(storyByIds?.[id])).map((id, i, ids) => (
            <MediaStory
              teactOrderKey={i}
              key={`${resultType}_${id}`}
              className={getGridCornerClassName(i, ids.length)}
              story={storyByIds![id]}
              isArchive={resultType === 'storiesArchive'}
            />
          ))
        ) : resultType === 'documents' ? (
          getViewportMediaItems().map(({ key, message, mediaIndex }) => (
            <Document
              key={key}
              id={`shared-media${getMessageHtmlId(message.id, mediaIndex)}`}
              document={getMessageDocument(message)!}
              datetime={message.date}
              fileSize="small"
              className="scroll-item"
              noDownload={isChatProtected || message.isProtected}
              isDownloading={getIsDownloading(activeDownloads, getMessageDocument(message)!)}
              observeIntersection={observeIntersectionForMedia}
              onDateClick={handleMessageFocus}
              message={message}
              shouldWarnAboutFiles={shouldWarnAboutFiles}
              mediaIndex={mediaIndex}
              onMediaClick={handleSelectMedia}
              contextActions={getMessageContextActions(message)}
            />
          ))
        ) : resultType === 'links' ? (
          (viewportIds as number[]).filter((id) => Boolean(messagesById[id])).map((id) => (
            <WebLink
              key={id}
              message={messagesById[id]}
              isProtected={isChatProtected || messagesById[id].isProtected}
              observeIntersection={observeIntersectionForMedia}
              contextActions={getMessageContextActions(messagesById[id])}
              onMessageClick={handleMessageFocus}
            />
          ))
        ) : resultType === 'audio' ? (
          getViewportMediaItems().map(({ key, message, mediaIndex }) => (
            <Audio
              key={key}
              theme={theme}
              message={message}
              mediaIndex={mediaIndex}
              variant="sharedMedia"
              threadId={threadId}
              date={message.date}
              className="scroll-item"
              onPlay={handlePlayAudio}
              onDateClick={handleMessageFocus}
              contextActions={getMessageContextActions(message)}
              canDownload={!isChatProtected && !message.isProtected}
              isDownloading={getIsDownloading(activeDownloads, message.content.audio!)}
            />
          ))
        ) : resultType === 'voice' ? (
          (viewportIds as number[]).filter((id) => Boolean(messagesById[id])).map((id) => {
            const global = getGlobal();
            const message = messagesById[id];

            const media = selectMessageDownloadableMedia(global, message)!;
            return (
              <Audio
                key={id}
                theme={theme}
                message={message}
                senderTitle={getSenderName(lang, message, chatsById, usersById)}
                variant="sharedMedia"
                threadId={threadId}
                date={message.date}
                className="scroll-item"
                onPlay={handlePlayAudio}
                onDateClick={handleMessageFocus}
                contextActions={getMessageContextActions(message)}
                canDownload={!isChatProtected && !message.isProtected}
                isDownloading={getIsDownloading(activeDownloads, media)}
              />
            );
          })
        ) : resultType === 'polls' ? (
          (viewportIds as number[]).filter((id) => Boolean(messagesById[id])).map((id) => (
            <ProfilePoll
              key={id}
              message={messagesById[id]}
              theme={theme}
              observeIntersection={observeIntersectionForMedia}
              contextActions={getMessageContextActions(messagesById[id])}
              onDateClick={handleMessageFocus}
            />
          ))
        ) : resultType === 'members' ? (
          (viewportIds as string[]).map((id, i) => (
            <ListItem
              key={id}
              teactOrderKey={i}
              className="chat-item-clickable contact-list-item scroll-item small-icon"

              onClick={() => handleMemberClick(id)}
              onFileHoverOpen={() => handleMemberClick(id)}
              contextActions={getMemberContextAction(id)}
              withPortalForMenu
            >
              <PrivateChatInfo
                userId={id}
                chatMemberOriginId={chatId}
                chatMember={adminMembersById?.[id] || membersById?.[id]}
                forceShowSelf
                withStory
              />
            </ListItem>
          ))
        ) : resultType === 'commonChats' ? (
          (viewportIds as string[]).map((id, i) => (
            <ListItem
              key={id}
              teactOrderKey={i}
              className="chat-item-clickable scroll-item small-icon"

              onClick={() => openChat({ id })}
            >
              <GroupChatInfo chatId={id} />
            </ListItem>
          ))
        ) : undefined}
      </div>
    );

    return wrapInIsland(contentEl);
  }

  const contentTransitionKey = (() => {
    if (resultType === 'stories') {
      return selectedStoryAlbumId === 'all' ? 0 : selectedStoryAlbumId;
    }
    return 0;
  })();

  function renderProfileInfo(peerId: string, isReady: boolean) {
    return (
      <div className={buildClassName(styles.profileInfo, 'profile-info')}>
        <ProfileInfo
          isExpanded={isProfileExpanded}
          isActive={isActive}
          peerId={peerId}
          canPlayVideo={isReady}
          onExpand={handleExpandProfile}
        />
        <ChatExtra
          chatOrUserId={profileId}
          isOwnProfile={isOwnProfile}
          className={styles.chatExtraBlock}
        />
      </div>
    );
  }

  function renderSpinnerOrContent(noContent: boolean, noSpinner: boolean) {
    const baseContent = renderSpinnerOrContentBase(noContent, noSpinner);

    const isSpinner = noContent && !noSpinner;

    if (shouldUseTransitionForContent) {
      return (
        <Transition
          className={CONTENT_LIST_CLASS[resultType]}
          activeKey={contentTransitionKey}
          name={resolveTransitionName('slideOptimized', animationLevel, undefined, lang.isRtl)}
          contentSelector={`.Transition > .Transition_slide-active > .${styles.content}`}
        >
          <Transition
            activeKey={isSpinner ? 0 : 1}
            name="fade"
            contentSelector={`.${styles.content}`}
          >
            {baseContent}
          </Transition>
        </Transition>
      );
    }

    return (
      <Transition
        activeKey={isSpinner ? 0 : 1}
        name="fade"
      >
        {baseContent}
      </Transition>
    );
  }

  return (
    <Surface
      ref={containerRef}
      scrollable
      noPadding
      className={buildClassName(styles.root, 'Profile')}
      onScroll={handleScroll}
    >
      {!isSavedMessages && (
        renderProfileInfo(
          profileId,
          isRightColumnShown && canRenderContent,
        )
      )}
      {!isRestricted && (
        <>
          <div
            ref={sharedMediaTabsRef}
            className={buildClassName(styles.sharedMediaTabs, 'shared-media-tabs')}
          >
            <TabList
              activeTab={activeTabIndex}
              tabs={tabs}
              onSwitchTab={handleSwitchTab}
            />
          </div>
          <div
            ref={sharedMediaRef}
            className={styles.sharedMedia}
          >
            <Transition
              ref={transitionRef}
              name={shouldSkipTransitionRef.current ? 'none'
                : resolveTransitionName('slideOptimized', animationLevel, undefined, lang.isRtl)}
              activeKey={activeKey}
              renderCount={tabs.length}
              className="shared-media-transition"
              contentSelector={shouldUseTransitionForContent ? NESTED_CONTENT_SELECTOR : undefined}
            >
              {renderContent()}
            </Transition>
          </div>
        </>
      )}

      {canAddMembers && (
        <FloatingActionButton
          className={buildClassName(!isActive && styles.hidden)}
          style={createVtnStyle('profileFab')}
          isShown={canRenderContent}
          onClick={handleNewMemberDialogOpen}
          ariaLabel={lang('ChannelAddUsers')}
          iconName="add-user-filled"
        />
      )}
    </Surface>
  );
};

function getPreloadSlice(resultType: ProfileTabType) {
  switch (resultType) {
    case 'members':
      return MEMBERS_SLICE;
    case 'polls':
      return PROFILE_POLLS_SLICE;
    default:
      return SHARED_MEDIA_SLICE;
  }
}

export default memo(withGlobal<OwnProps>(
  (global, {
    chatId, threadId, isMobile,
  }): Complete<StateProps> => {
    const user = selectUser(global, chatId);
    const chat = selectChat(global, chatId);
    const chatFullInfo = selectChatFullInfo(global, chatId);
    const userFullInfo = selectUserFullInfo(global, chatId);
    const messagesById = selectChatMessages(global, chatId);

    const tabState = selectTabState(global);
    const { chatInfo } = tabState;
    const { isOwnProfile } = chatInfo;

    const { animationLevel, shouldWarnAboutFiles } = selectSharedSettings(global);

    const { currentType: mediaSearchType, resultsByType } = selectCurrentSharedMediaSearch(global) || {};
    const { foundIds } = (resultsByType && mediaSearchType && resultsByType[mediaSearchType]) || {};

    const { byId: usersById, statusesById: userStatusesById } = global.users;
    const { byId: chatsById } = global.chats;

    const isSavedMessages = chatId === global.currentUserId && !isOwnProfile;

    const isGroup = chat && isChatGroup(chat);
    const hasMembersTab = isGroup;
    const members = chatFullInfo?.members;
    const adminMembersById = chatFullInfo?.adminMembersById;
    const areMembersHidden = hasMembersTab && chat
      && (chat.isForbidden || (chatFullInfo && !chatFullInfo.canViewMembers));
    const canAddMembers = hasMembersTab && chat
      && (getHasAdminRight(chat, 'inviteUsers') || !isUserRightBanned(chat, 'inviteUsers'));
    const canDeleteMembers = hasMembersTab && selectCanBanUsers(global, chatId);
    const activeDownloads = selectActiveDownloads(global);
    const isCurrentUserFrozen = selectIsCurrentUserFrozen(global);

    const peer = user || chat;
    const peerFullInfo = userFullInfo || chatFullInfo;

    const hasCommonChatsTab = user && !user.isSelf && !isSavedMessages
      && Boolean(userFullInfo?.commonChatsCount);
    const commonChats = selectUserCommonChats(global, chatId);

    const hasStoriesTab = peer && (user?.isSelf || (!peer.areStoriesHidden && peerFullInfo?.hasPinnedStories))
      && !isSavedMessages;
    const peerStories = hasStoriesTab ? selectPeerStories(global, peer.id) : undefined;
    const selectedStoryAlbumId = selectActiveStoriesCollectionId(global);
    const profileStoryIds = peerStories?.profileIds.length || peerStories?.isFullyLoaded || isCurrentUserFrozen
      ? peerStories?.profileIds
      : undefined;
    const storyIds = selectedStoryAlbumId !== 'all'
      ? peerStories?.idsByAlbumId?.[selectedStoryAlbumId]?.ids
      : profileStoryIds;
    const pinnedStoryIds = peerStories?.pinnedIds;
    const storyByIds = peerStories?.byId;
    const archiveStoryIds = peerStories?.archiveIds;

    const areProfileTabsKnown = isCurrentUserFrozen || (chat && isChatBasicGroup(chat))
      || peerFullInfo?.hasPinnedStories !== undefined;

    const storyAlbums = global.stories.albumsByPeerId?.[chatId];

    const isRestricted = chat && selectIsChatRestricted(global, chat.id);
    const hasAvatar = Boolean(peer?.avatarPhotoId);

    const canAutoPlayGifs = selectPerformanceSettingsValue(global, 'autoplayGifs');

    return {
      theme: selectTheme(global),
      messagesById,
      foundIds,
      mediaSearchType,
      hasCommonChatsTab,
      hasStoriesTab,
      hasMembersTab,
      areMembersHidden,
      canAddMembers,
      canDeleteMembers,
      currentUserId: global.currentUserId,
      isRightColumnShown: selectIsRightColumnShown(global, isMobile),
      isRestricted,
      activeDownloads,
      usersById,
      userStatusesById,
      chatsById,
      storyIds,
      areProfileTabsKnown,
      storyAlbums,
      pinnedStoryIds,
      archiveStoryIds,
      storyByIds,
      selectedStoryAlbumId,
      isChatProtected: chat?.isProtected,
      chatInfo,
      animationLevel,
      shouldWarnAboutFiles,
      isSavedMessages,
      isSynced: global.isSynced,
      members: hasMembersTab ? members : undefined,
      adminMembersById: hasMembersTab ? adminMembersById : undefined,
      commonChatIds: commonChats?.ids,
      hasAvatar,
      peerFullInfo,
      canAutoPlayGifs,
    };
  },
)(Profile));
