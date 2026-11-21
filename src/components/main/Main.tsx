import '../../global/actions/all';

import {
  beginHeavyAnimation,
  memo, onFullyIdle, useEffect, useLayoutEffect,
  useRef, useState,
} from '../../lib/teact/teact';
import { addExtraClass, setExtraStyles } from '../../lib/teact/teact-dom';
import { getActions, getGlobal, withGlobal } from '../../global';

import type { ApiChatFolder, ApiLimitTypeWithModal } from '../../api/types';
import type { TabState } from '../../global/types';

import { BASE_EMOJI_KEYWORD_LANG, DEBUG, FOLDERS_POSITION_LEFT } from '../../config';
import { requestNextMutation } from '../../lib/fasterdom/fasterdom';
import {
  selectAreFoldersPresent,
  selectCanAnimateInterface,
  selectChatFolder,
  selectCurrentMessageList,
  selectIsCurrentUserFrozen,
  selectIsForwardModalOpen,
  selectIsMediaViewerOpen,
  selectIsReactionPickerOpen,
  selectIsRightColumnShown,
  selectIsStoryViewerOpen,
  selectPerformanceSettingsValue,
  selectTabState,
  selectUser,
} from '../../global/selectors';
import { selectSharedSettings } from '../../global/selectors/sharedState';
import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { IS_ANDROID, IS_IOS, IS_MAC_OS, IS_WAVE_TRANSFORM_SUPPORTED } from '../../util/browser/windowEnvironment';
import buildClassName from '../../util/buildClassName';
import { waitForTransitionEnd } from '../../util/cssAnimationEndListeners';
import { openSignalLink, processDeepLink } from '../../util/deeplink';
import { Bundles, loadBundle } from '../../util/moduleLoader';
import { parseInitialLocationHash, parseLocationHash } from '../../util/routing';
import { parseSignalLink } from '../../util/signalLinks';
import updateIcon from '../../util/updateIcon';
import { REM } from '../common/helpers/mediaDimensions';
import { updateTopReserveWithScrollCompensation } from '../middle/helpers/messageListReserves';

import useInterval from '../../hooks/schedulers/useInterval';
import useTimeout from '../../hooks/schedulers/useTimeout';
import useDesktopApp from '../../hooks/tauri/useDesktopApp';
import useTauriEvent from '../../hooks/tauri/useTauriEvent';
import useAppLayout from '../../hooks/useAppLayout';
import useForceUpdate from '../../hooks/useForceUpdate';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import usePreventPinchZoomGesture from '../../hooks/usePreventPinchZoomGesture';
import useShowTransition from '../../hooks/useShowTransition';
import useSyncEffect from '../../hooks/useSyncEffect';
import useBackgroundMode from '../../hooks/window/useBackgroundMode';
import useBeforeUnload from '../../hooks/window/useBeforeUnload';
import { useFullscreenStatus } from '../../hooks/window/useFullscreen';
import { PANE_GAP_REM, type PaneState } from '../middle/hooks/useHeaderPane';

import CustomEmojiSetsModal from '../common/CustomEmojiSetsModal.async';
import DeleteMessageModal from '../common/DeleteMessageModal.async';
import StickerSetModal from '../common/StickerSetModal.async';
import UnreadCount from '../common/UnreadCounter';
import Wallpaper from '../common/Wallpaper';
import LeftColumn from '../left/LeftColumn';
import MediaViewer from '../mediaViewer/MediaViewer.async';
import ReactionPicker from '../middle/message/reactions/ReactionPicker.async';
import MessageListHistoryHandler from '../middle/MessageListHistoryHandler';
import MiddleColumn from '../middle/MiddleColumn';
import AudioPlayer from '../middle/panes/AudioPlayer';
import FloatingRoundVideo from '../middle/panes/FloatingRoundVideo';
import ModalContainer from '../modals/ModalContainer';
import RightColumn from '../right/RightColumn';
import StoryViewer from '../story/StoryViewer.async';
import DeleteFolderDialog from './DeleteFolderDialog.async';
import DownloadManager from './DownloadManager';
import DraftRecipientPicker from './DraftRecipientPicker.async';
import FoldersSidebar from './FoldersSidebar';
import ForwardRecipientPicker from './ForwardRecipientPicker.async';
import HistoryCalendar from './HistoryCalendar.async';
import LimitReachedModal from './LimitReachedModal.async';
import NewContactModal from './NewContactModal.async';
import ConfettiContainer from './visualEffects/ConfettiContainer';
import WaveContainer from './visualEffects/WaveContainer';

import './Main.scss';
import backgroundStyles from '../../styles/_patternBackground.module.scss';

export interface OwnProps {
  isMobile?: boolean;
}

type StateProps = {
  chatId?: string;
  isMasterTab?: boolean;
  currentUserId?: string;
  hasCurrentUser?: boolean;
  isLeftColumnOpen: boolean;
  isMiddleColumnOpen: boolean;
  isRightColumnOpen: boolean;
  isMediaViewerOpen: boolean;
  isStoryViewerOpen: boolean;
  isForwardModalOpen: boolean;
  isHistoryCalendarOpen: boolean;
  shouldSkipHistoryAnimations?: boolean;
  openedStickerSetShortName?: string;
  openedCustomEmojiSetIds?: string[];
  wasTimeFormatSetManually?: boolean;
  addedSetIds?: string[];
  newContactUserId?: string;
  newContactByPhoneNumber?: boolean;
  requestedDraft?: TabState['requestedDraft'];
  limitReached?: ApiLimitTypeWithModal;
  deleteFolderDialog?: ApiChatFolder;
  isReactionPickerOpen: boolean;
  isDeleteMessageModalOpen?: boolean;
  noRightColumnAnimation?: boolean;
  withInterfaceAnimations?: boolean;
  isSynced?: boolean;
  isAccountFrozen?: boolean;
  isAppConfigLoaded?: boolean;
  isFoldersSidebarShown: boolean;
  diceEmojies?: string[];
};

const APP_OUTDATED_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const EDITOR_BUNDLE_LOADING_DELAY_MS = 10000; // 10 sec

let DEBUG_isLogged = false;

const Main = ({
  isMobile,
  chatId,
  isLeftColumnOpen,
  isMiddleColumnOpen,
  isRightColumnOpen,
  isMediaViewerOpen,
  isStoryViewerOpen,
  isForwardModalOpen,
  isHistoryCalendarOpen,
  shouldSkipHistoryAnimations,
  limitReached,
  openedStickerSetShortName,
  openedCustomEmojiSetIds,
  withInterfaceAnimations,
  wasTimeFormatSetManually,
  addedSetIds,
  newContactUserId,
  newContactByPhoneNumber,
  requestedDraft,
  isDeleteMessageModalOpen,
  isReactionPickerOpen,
  deleteFolderDialog,
  isMasterTab,
  noRightColumnAnimation,
  isSynced,
  currentUserId,
  hasCurrentUser,
  isAccountFrozen,
  isAppConfigLoaded,
  isFoldersSidebarShown,
  diceEmojies,
}: OwnProps & StateProps) => {
  const {
    initMain,
    loadAnimatedEmojis,
    loadBirthdayNumbersStickers,
    loadRestrictedEmojiStickers,
    loadNotificationSettings,
    loadNotificationExceptions,
    updateIsOnline,
    onTabFocusChange,
    loadEmojiKeywords,
    loadCountryList,
    loadAvailableReactions,
    loadStickerSets,
    loadDiceStickers,
    loadAddedStickers,
    ensureTimeFormat,
    closeStickerSetModal,
    closeCustomEmojiSets,
    loadConfig,
    loadAppConfig,
    loadContactList,
    loadCustomEmojis,
    loadGenericEmojiEffects,
    checkAppVersion,
    openChat,
    toggleLeftColumn,
    updatePageTitle,
    loadFeaturedEmojiStickers,
    loadPeerColors,
    openRecoveryKeyModal,
    loadAllStories,
    loadAllHiddenStories,
    loadStorySettings,
    loadContentSettings,
    loadPromoData,
  } = getActions();

  if (DEBUG && !DEBUG_isLogged) {
    DEBUG_isLogged = true;
    // eslint-disable-next-line no-console
    console.log('>>> RENDER MAIN');
  }

  const lang = useLang();
  useDesktopApp();

  useTimeout(() => {
    onFullyIdle(() => {
      void loadBundle(Bundles.Editor);
    });
  }, isSynced ? EDITOR_BUNDLE_LOADING_DELAY_MS : undefined);

  const containerRef = useRef<HTMLDivElement>();
  const leftColumnRef = useRef<HTMLDivElement>();

  const { isDesktop } = useAppLayout();
  useEffect(() => {
    if (!isLeftColumnOpen && !isMiddleColumnOpen && !isDesktop) {
      // Always display at least one column
      toggleLeftColumn();
    } else if (isLeftColumnOpen && isMiddleColumnOpen && isMobile) {
      // Can't have two active columns at the same time
      toggleLeftColumn();
    }
  }, [isDesktop, isLeftColumnOpen, isMiddleColumnOpen, isMobile, toggleLeftColumn]);

  useEffect(() => {
    if (IS_TAURI && IS_MAC_OS) {
      window.tauri?.markTitleBarOverlay(true, isMobile);
    }
  }, [isMobile]);

  useInterval(checkAppVersion, isMasterTab ? APP_OUTDATED_TIMEOUT_MS : undefined, true);

  // The recovery key of a new account shows once per start, until the user confirms to have saved it
  const hasCheckedRecoveryKeyRef = useRef(false);
  useEffect(() => {
    if (!isMasterTab || !isSynced || hasCheckedRecoveryKeyRef.current) return;
    hasCheckedRecoveryKeyRef.current = true;
    openRecoveryKeyModal({ shouldSkipConfirmed: true });
  }, [isMasterTab, isSynced]);

  // Initial API calls
  useEffect(() => {
    if (isMasterTab && isSynced) {
      updateIsOnline({ isOnline: true });
      loadConfig();
      loadAppConfig();
      loadPeerColors();
      initMain();
      loadContactList();
      checkAppVersion();
      loadNotificationSettings();
      loadNotificationExceptions();
      // Signal stories come from the local database and need no app config
      loadAllStories();
      loadAllHiddenStories();
      loadStorySettings();
    }
  }, [isMasterTab, isSynced]);

  // Initial API calls
  useEffect(() => {
    if (isMasterTab && isSynced && isAppConfigLoaded && !isAccountFrozen) {
      loadPromoData();
      loadContentSettings();
      loadEmojiKeywords({ language: BASE_EMOJI_KEYWORD_LANG });
      loadFeaturedEmojiStickers();
      loadAnimatedEmojis();
      loadAvailableReactions();
      loadGenericEmojiEffects();
      loadBirthdayNumbersStickers();
      loadRestrictedEmojiStickers();
    }
  }, [isMasterTab, isSynced, isAppConfigLoaded, isAccountFrozen]);

  // Language-based API calls
  useEffect(() => {
    if (isMasterTab) {
      if (lang.code !== BASE_EMOJI_KEYWORD_LANG) {
        loadEmojiKeywords({ language: lang.code });
      }

      loadCountryList({ langCode: lang.code });
    }
  }, [lang.code, isMasterTab]);

  // Re-fetch cached saved emoji for `localDb`
  useEffect(() => {
    if (isMasterTab) {
      loadCustomEmojis({
        ids: Object.keys(getGlobal().customEmojis.byId),
        ignoreCache: true,
      });
    }
  }, [isMasterTab]);

  // Installed Signal sticker packs, which need no app config
  useEffect(() => {
    if (!isMasterTab || !isSynced) return;
    if (addedSetIds) {
      loadAddedStickers();
    } else {
      loadStickerSets();
    }
  }, [addedSetIds, isMasterTab, isSynced]);

  useEffect(() => {
    if (isMasterTab && isSynced && isAppConfigLoaded && !isAccountFrozen && diceEmojies) {
      loadDiceStickers();
    }
  }, [isMasterTab, isSynced, isAppConfigLoaded, isAccountFrozen, diceEmojies]);

  // Ensure time format
  useEffect(() => {
    if (!wasTimeFormatSetManually) {
      ensureTimeFormat();
    }
  }, [wasTimeFormatSetManually]);

  // Parse deep link
  useEffect(() => {
    if (!isSynced) return;
    updatePageTitle();

    const parsedInitialLocationHash = parseInitialLocationHash();
    // The link is deleted after the first use. `isSynced` turns true again after every reconnect and unlock, and the
    // same link would open again each time. A page of the web can put a link into the address, so only Signal's links
    // open from it.
    if (parsedInitialLocationHash?.tgaddr) {
      const signalLink = parseSignalLink(parsedInitialLocationHash.tgaddr);
      delete parsedInitialLocationHash.tgaddr;
      if (signalLink) openSignalLink(signalLink);
    }
  }, [isSynced]);

  // The links that launched the app, or reached it before this page could listen, wait in the native app until the
  // chats are loaded, as an opened chat would be reset by the sync and an action would fail before the account is ready
  const handleDeepLinks = useLastCallback(async () => {
    if (!isSynced) return;

    try {
      const urls = await window.tauri.takeDeepLinks();
      urls.forEach((url) => processDeepLink(url, { type: 'inner' }));
    } catch (e) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.error('Failed to process deep links', e);
      }
    }
  });

  useTauriEvent<void>('deeplink', handleDeepLinks, handleDeepLinks);

  useEffect(() => {
    if (IS_TAURI && isSynced) handleDeepLinks();
  }, [isSynced]);

  useEffect(() => {
    const parsedLocationHash = parseLocationHash(currentUserId);
    if (!parsedLocationHash) return;

    openChat({
      id: parsedLocationHash.chatId,
      type: parsedLocationHash.type,
    });
  }, [currentUserId]);

  // Restore Transition slide class after async rendering
  useLayoutEffect(() => {
    const container = containerRef.current!;
    if (container.parentNode!.childElementCount === 1) {
      addExtraClass(container, 'Transition_slide-active');
    }
  }, []);

  useShowTransition({
    ref: containerRef,
    isOpen: isLeftColumnOpen,
    noCloseTransition: shouldSkipHistoryAnimations,
    prefix: 'left-column-',
  });
  const willAnimateLeftColumnRef = useRef(false);
  const forceUpdate = useForceUpdate();

  // Handle opening middle column
  useSyncEffect(([prevIsLeftColumnOpen]) => {
    if (prevIsLeftColumnOpen === undefined || isLeftColumnOpen === prevIsLeftColumnOpen || !withInterfaceAnimations) {
      return;
    }

    willAnimateLeftColumnRef.current = true;

    if (IS_ANDROID) {
      requestNextMutation(() => {
        document.body.classList.toggle('android-left-blackout-open', !isLeftColumnOpen);
      });
    }

    const endHeavyAnimation = beginHeavyAnimation();

    waitForTransitionEnd(document.getElementById('MiddleColumn')!, () => {
      endHeavyAnimation();
      willAnimateLeftColumnRef.current = false;
      forceUpdate();
    });
  }, [isLeftColumnOpen, withInterfaceAnimations, forceUpdate]);

  useShowTransition({
    ref: containerRef,
    isOpen: isRightColumnOpen,
    noMountTransition: true,
    noCloseTransition: shouldSkipHistoryAnimations,
    prefix: 'right-column-',
  });
  const willAnimateRightColumnRef = useRef(false);
  const [isNarrowMessageList, setIsNarrowMessageList] = useState(isRightColumnOpen);

  const isFullscreen = useFullscreenStatus();

  // Handle opening right column
  useSyncEffect(([prevIsMiddleColumnOpen, prevIsRightColumnOpen]) => {
    if (prevIsRightColumnOpen === undefined || isRightColumnOpen === prevIsRightColumnOpen) {
      return;
    }

    if (!prevIsMiddleColumnOpen || noRightColumnAnimation) {
      setIsNarrowMessageList(isRightColumnOpen);
      return;
    }

    willAnimateRightColumnRef.current = true;

    const endHeavyAnimation = beginHeavyAnimation();

    waitForTransitionEnd(document.getElementById('RightColumn')!, () => {
      endHeavyAnimation();
      willAnimateRightColumnRef.current = false;
      forceUpdate();
      setIsNarrowMessageList(isRightColumnOpen);
    });
  }, [isMiddleColumnOpen, isRightColumnOpen, noRightColumnAnimation, forceUpdate]);

  const bgClassName = buildClassName(
    !noRightColumnAnimation && backgroundStyles.withTransition,
  );

  const className = buildClassName(
    willAnimateLeftColumnRef.current && 'left-column-animating',
    willAnimateRightColumnRef.current && 'right-column-animating',
    isNarrowMessageList && 'narrow-message-list',
    shouldSkipHistoryAnimations && 'history-animation-disabled',
    isFullscreen && 'is-fullscreen',
    isFoldersSidebarShown && 'folders-sidebar-visible',
  );

  const handleBlur = useLastCallback(() => {
    onTabFocusChange({ isBlurred: true });
  });

  const handleFocus = useLastCallback(() => {
    onTabFocusChange({ isBlurred: false });

    updatePageTitle();

    updateIcon(false);
  });

  const playerReserveRef = useRef(0);
  const handlePlayerPaneStateChange = useLastCallback(({ height }: PaneState) => {
    const main = containerRef.current;
    const middleColumn = document.getElementById('MiddleColumn');
    if (!main || !middleColumn) return;
    const occupiedHeight = height ? height + PANE_GAP_REM * REM : 0;
    const heightDelta = occupiedHeight - playerReserveRef.current;
    if (!heightDelta) return;
    playerReserveRef.current = occupiedHeight;
    const parkedShift = occupiedHeight ? '0px' : 'var(--middle-panel-inline-padding)';
    updateTopReserveWithScrollCompensation(middleColumn, heightDelta, () => {
      setExtraStyles(main, {
        '--middle-header-player-height': `${occupiedHeight}px`,
        '--middle-header-player-parked': parkedShift,
      });
      setExtraStyles(middleColumn, {
        '--middle-header-player-height': `${occupiedHeight}px`,
        '--middle-header-player-parked': parkedShift,
      });
    }, [main]);
  });

  const handleStickerSetModalClose = useLastCallback(() => {
    closeStickerSetModal();
  });

  const handleCustomEmojiSetsModalClose = useLastCallback(() => {
    closeCustomEmojiSets();
  });

  // Online status and browser tab indicators
  useBackgroundMode(handleBlur, handleFocus, IS_TAURI);
  useBeforeUnload(handleBlur);
  usePreventPinchZoomGesture(isMediaViewerOpen || isStoryViewerOpen);

  return (
    <Wallpaper
      chatId={chatId}
      containerRef={containerRef}
      id="Main"
      className={className}
      bgClassName={bgClassName}
      shouldExtendChatWallpaper={!isMobile}
      withSnapshot
      browserColorMode={!IS_IOS || !isMobile ? undefined
        : isMiddleColumnOpen && !isLeftColumnOpen && !isRightColumnOpen ? 'wallpaper' : 'surface'}
    >
      {IS_TAURI && IS_MAC_OS && (
        <div className="tauri-drag-region" data-tauri-drag-region />
      )}
      <FoldersSidebar isMobile={isMobile} isActive={isFoldersSidebarShown} />
      <LeftColumn ref={leftColumnRef} isFoldersSidebarShown={isFoldersSidebarShown} />
      <MiddleColumn
        leftColumnRef={leftColumnRef}
        isMobile={isMobile}
        onPlayerPaneStateChange={handlePlayerPaneStateChange}
      />
      <RightColumn isMobile={isMobile} />
      <MediaViewer isOpen={isMediaViewerOpen} />
      <StoryViewer isOpen={isStoryViewerOpen} />
      <ForwardRecipientPicker isOpen={isForwardModalOpen} />
      <DraftRecipientPicker requestedDraft={requestedDraft} />
      <AudioPlayer noUi />
      <FloatingRoundVideo />
      <ModalContainer />
      <HistoryCalendar isOpen={isHistoryCalendarOpen} />
      <StickerSetModal
        isOpen={Boolean(openedStickerSetShortName)}
        onClose={handleStickerSetModalClose}
        stickerSetShortName={openedStickerSetShortName}
      />
      <CustomEmojiSetsModal
        customEmojiSetIds={openedCustomEmojiSetIds}
        onClose={handleCustomEmojiSetsModalClose}
      />
      <NewContactModal
        isOpen={Boolean(newContactUserId || newContactByPhoneNumber)}
        userId={newContactUserId}
        isByPhoneNumber={newContactByPhoneNumber}
      />
      <DownloadManager />
      <ConfettiContainer />
      {IS_WAVE_TRANSFORM_SUPPORTED && <WaveContainer />}
      <UnreadCount isForAppBadge />
      <MessageListHistoryHandler />
      <LimitReachedModal limit={limitReached} />
      <DeleteFolderDialog folder={deleteFolderDialog} />
      <ReactionPicker isOpen={isReactionPickerOpen} />
      <DeleteMessageModal isOpen={isDeleteMessageModalOpen} />
    </Wallpaper>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { isMobile }): Complete<StateProps> => {
    const {
      currentUserId,
    } = global;

    const {
      requestedDraft,
      openedStickerSetShortName,
      openedCustomEmojiSetIds,
      shouldSkipHistoryAnimations,
      isLeftColumnShown,
      historyCalendarSelectedAt,
      newContact,
      deleteMessageModal,
      isMasterTab,
      limitReachedModal,
      deleteFolderDialogModal,
    } = selectTabState(global);

    const { wasTimeFormatSetManually, foldersPosition } = selectSharedSettings(global);

    const { chatId } = selectCurrentMessageList(global) || {};
    const noRightColumnAnimation = !selectPerformanceSettingsValue(global, 'rightColumnAnimations')
      || !selectCanAnimateInterface(global);

    const deleteFolderDialog = deleteFolderDialogModal ? selectChatFolder(global, deleteFolderDialogModal) : undefined;
    const isAccountFrozen = selectIsCurrentUserFrozen(global);

    return {
      chatId,
      currentUserId,
      hasCurrentUser: Boolean(selectUser(global, currentUserId!)),
      isLeftColumnOpen: isLeftColumnShown,
      isMiddleColumnOpen: Boolean(chatId),
      isRightColumnOpen: selectIsRightColumnShown(global, isMobile),
      isMediaViewerOpen: selectIsMediaViewerOpen(global),
      isStoryViewerOpen: selectIsStoryViewerOpen(global),
      isForwardModalOpen: selectIsForwardModalOpen(global),
      isReactionPickerOpen: selectIsReactionPickerOpen(global),
      isHistoryCalendarOpen: Boolean(historyCalendarSelectedAt),
      shouldSkipHistoryAnimations,
      openedStickerSetShortName,
      openedCustomEmojiSetIds,
      withInterfaceAnimations: selectCanAnimateInterface(global),
      wasTimeFormatSetManually,
      addedSetIds: global.stickers.added.setIds,
      newContactUserId: newContact?.userId,
      newContactByPhoneNumber: newContact?.isByPhoneNumber,
      isDeleteMessageModalOpen: Boolean(deleteMessageModal),
      limitReached: limitReachedModal?.limit,
      deleteFolderDialog,
      isMasterTab,
      requestedDraft,
      noRightColumnAnimation,
      isSynced: global.isSynced,
      isAccountFrozen,
      isAppConfigLoaded: global.isAppConfigLoaded,
      isFoldersSidebarShown: foldersPosition === FOLDERS_POSITION_LEFT && !isMobile && selectAreFoldersPresent(global),
      diceEmojies: global.appConfig?.diceEmojies,
    };
  },
)(Main));
