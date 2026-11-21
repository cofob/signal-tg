import { addCallback } from '../../../lib/teact/teactn';

import type { ActionReturnType, GlobalState } from '../../types';

import {
  ANIMATION_WAVE_MIN_INTERVAL,
  DEBUG, GLOBAL_STATE_CACHE_CUSTOM_EMOJI_LIMIT, PAGE_TITLE,
  PAGE_TITLE_TAURI,
} from '../../../config';
import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import { IS_WAVE_TRANSFORM_SUPPORTED } from '../../../util/browser/windowEnvironment';
import { getAllMultitabTokens, getCurrentTabId } from '../../../util/establishMultitabRole';
import { getAllNotificationsCount } from '../../../util/folderManager';
import getIsAppUpdateNeeded from '../../../util/getIsAppUpdateNeeded';
import { shouldShowErrorDialog } from '../../../util/getReadableErrorText';
import { compact, unique } from '../../../util/iteratees';
import { getTranslationFn } from '../../../util/localization';
import updateIcon from '../../../util/updateIcon';
import { setPageTitle, setPageTitleInstant } from '../../../util/updatePageTitle';
import {
  canEditMediaInEditor, getAllowedAttachmentOptions, getChatTitle,
} from '../../helpers';
import { addTabStateResetterAction } from '../../helpers/meta';
import {
  addActionHandler, getActions, getGlobal, setGlobal,
} from '../../index';
import { updateTabState } from '../../reducers/tabs';
import {
  selectCanAnimateInterface,
  selectChat,
  selectChatMessage,
  selectCurrentMessageList,
  selectIsChatWithSelf,
  selectTabState,
} from '../../selectors';
import { selectSharedSettings } from '../../selectors/sharedState';

import { getIsMobile, getIsTablet } from '../../../hooks/useAppLayout';

export const APP_VERSION_URL = 'version.txt';
const MAX_STORED_EMOJIS = 8 * 4; // Represents four rows of recent emojis

addActionHandler('toggleChatInfo', (global, actions, payload): ActionReturnType => {
  const { force, tabId = getCurrentTabId() } = payload || {};
  const chatInfo = selectTabState(global, tabId).chatInfo;
  const willChatInfoBeShown = force !== undefined ? force : !chatInfo.isOpen;

  if (willChatInfoBeShown !== chatInfo.isOpen) {
    global = updateTabState(global, {
      chatInfo: {
        ...chatInfo,
        isOpen: willChatInfoBeShown,
      },
    }, tabId);
  }
  global = { ...global, lastIsChatInfoShown: willChatInfoBeShown };

  return global;
});

addActionHandler('setLeftColumnWidth', (global, actions, payload): ActionReturnType => {
  const { leftColumnWidth } = payload;

  return {
    ...global,
    leftColumnWidth,
  };
});

addActionHandler('resetLeftColumnWidth', (global): ActionReturnType => {
  return {
    ...global,
    leftColumnWidth: undefined,
  };
});

addActionHandler('toggleManagement', (global, actions, payload): ActionReturnType => {
  const { force, tabId = getCurrentTabId() } = payload || {};
  const { chatId } = selectCurrentMessageList(global, tabId) || {};

  if (!chatId) {
    return undefined;
  }

  const tabState = selectTabState(global, tabId);

  return updateTabState(global, {
    management: {
      byChatId: {
        ...tabState.management.byChatId,
        [chatId]: {
          ...tabState.management.byChatId[chatId],
          isActive: force !== undefined ? force : !(tabState.management.byChatId[chatId] || {}).isActive,
        },
      },
    },
  }, tabId);
});

addActionHandler('requestNextManagementScreen', (global, actions, payload): ActionReturnType => {
  const { screen, tabId = getCurrentTabId() } = payload || {};
  const { chatId } = selectCurrentMessageList(global, tabId) || {};

  if (!chatId) {
    return undefined;
  }

  const tabState = selectTabState(global, tabId);

  return updateTabState(global, {
    management: {
      byChatId: {
        ...tabState.management.byChatId,
        [chatId]: {
          ...tabState.management.byChatId[chatId],
          isActive: true,
          nextScreen: screen,
        },
      },
    },
  }, tabId);
});

addActionHandler('closeManagement', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const { chatId } = selectCurrentMessageList(global, tabId) || {};

  if (!chatId) {
    return undefined;
  }

  const tabState = selectTabState(global, tabId);

  return updateTabState(global, {
    management: {
      byChatId: {
        ...tabState.management.byChatId,
        [chatId]: {
          ...tabState.management.byChatId[chatId],
          isActive: false,
        },
      },
    },
  }, tabId);
});

addActionHandler('processOpenChatOrThread', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload;
  if (!getIsMobile() && !getIsTablet()) {
    return undefined;
  }

  return updateTabState(global, {
    isLeftColumnShown: selectTabState(global, tabId).messageLists.length === 0,
  }, tabId);
});

addActionHandler('changeProfileTab', (global, actions, payload): ActionReturnType => {
  const { profileTab, shouldScrollTo, tabId = getCurrentTabId() } = payload;
  const { chatId } = selectCurrentMessageList(global, tabId) || {};

  if (!chatId) {
    return undefined;
  }

  const chatInfo = selectTabState(global, tabId).chatInfo;

  return updateTabState(global, {
    chatInfo: {
      ...chatInfo,
      isOpen: true,
      profileTab,
      forceScrollProfileTab: shouldScrollTo,
    },
  }, tabId);
});

addActionHandler('toggleLeftColumn', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  return updateTabState(global, {
    isLeftColumnShown: !selectTabState(global, tabId).isLeftColumnShown,
  }, tabId);
});

addActionHandler('addRecentEmoji', (global, actions, payload): ActionReturnType => {
  const { emoji } = payload;
  const { recentEmojis } = global;
  if (!recentEmojis) {
    return {
      ...global,
      recentEmojis: [emoji],
    };
  }

  const newEmojis = recentEmojis.filter((e) => e !== emoji);
  newEmojis.unshift(emoji);
  if (newEmojis.length > MAX_STORED_EMOJIS) {
    newEmojis.pop();
  }

  return {
    ...global,
    recentEmojis: newEmojis,
  };
});

addActionHandler('addRecentSticker', (global, actions, payload): ActionReturnType => {
  const { sticker } = payload;
  const { recent } = global.stickers;
  if (!recent) {
    return {
      ...global,
      stickers: {
        ...global.stickers,
        recent: {
          hash: '0',
          stickers: [sticker],
        },
      },
    };
  }

  const newStickers = recent.stickers.filter((s) => s.id !== sticker.id);
  newStickers.unshift(sticker);

  return {
    ...global,
    stickers: {
      ...global.stickers,
      recent: {
        ...recent,
        stickers: newStickers,
      },
    },
  };
});

addActionHandler('addRecentCustomEmoji', (global, actions, payload): ActionReturnType => {
  const { documentId } = payload;
  const { recentCustomEmojis } = global;
  if (!recentCustomEmojis) {
    return {
      ...global,
      recentCustomEmojis: [documentId],
    };
  }

  const newEmojis = recentCustomEmojis.filter((id) => id !== documentId);
  newEmojis.unshift(documentId);
  if (newEmojis.length > MAX_STORED_EMOJIS) {
    newEmojis.pop();
  }

  return {
    ...global,
    recentCustomEmojis: newEmojis,
  };
});

addActionHandler('clearRecentCustomEmoji', (global): ActionReturnType => {
  return {
    ...global,
    recentCustomEmojis: [],
  };
});

addActionHandler('reorderStickerSets', (global, actions, payload): ActionReturnType => {
  const { order, isCustomEmoji } = payload;
  return {
    ...global,
    stickers: {
      ...global.stickers,
      added: {
        setIds: (!isCustomEmoji ? order : global.stickers.added.setIds),
      },
    },
    customEmojis: {
      ...global.customEmojis,
      added: {
        setIds: (isCustomEmoji ? order : global.customEmojis.added.setIds),
      },
    },
  };
});

addActionHandler('showAllowedMessageTypesNotification', (global, actions, payload): ActionReturnType => {
  const { chatId, tabId = getCurrentTabId() } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) return;
  const isSavedMessages = chatId ? selectIsChatWithSelf(global, chatId) : undefined;

  const {
    canSendPlainText, canSendPhotos, canSendVideos, canSendDocuments, canSendAudios,
    canSendStickers, canSendRoundVideos, canSendVoices,
  } = getAllowedAttachmentOptions(chat, isSavedMessages);
  const lang = getTranslationFn();
  const allowedContent = compact([
    canSendPlainText ? lang('ChatAllowedText') : undefined,
    canSendPhotos ? lang('ChatAllowedPhotos') : undefined,
    canSendVideos ? lang('ChatAllowedVideos') : undefined,
    canSendVoices ? lang('ChatAllowedVoices') : undefined,
    canSendRoundVideos ? lang('ChatAllowedVideoMessages') : undefined,
    canSendDocuments ? lang('ChatAllowedFiles') : undefined,
    canSendAudios ? lang('ChatAllowedMusic') : undefined,
    canSendStickers ? lang('ChatAllowedStickers') : undefined,
  ]);

  if (!allowedContent.length) {
    actions.showNotification({
      message: {
        key: 'ChatSendNotAllowedText',
        options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
      },
      tabId,
    });
    return;
  }

  const allowedContentString = lang.conjunction(allowedContent);

  actions.showNotification({
    message: {
      key: 'ChatSendAllowedContentText',
      variables: {
        types: allowedContentString,
      },
      options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
    },
    tabId,
  });
});

addActionHandler('showDialog', (global, actions, payload): ActionReturnType => {
  const { data, tabId = getCurrentTabId() } = payload;

  // Filter out errors that we don't want to show to the user
  if (data.type === 'error' && !shouldShowErrorDialog(data)) {
    return global;
  }

  const newDialogs = [...selectTabState(global, tabId).dialogs];
  if (data.type === 'error') {
    const existingErrorIndex = newDialogs.findIndex((dialog) => {
      return dialog.type === 'error' && dialog.message === data.message;
    });
    if (existingErrorIndex !== -1) {
      newDialogs.splice(existingErrorIndex, 1);
    }
  }

  newDialogs.push(data);

  return updateTabState(global, {
    dialogs: newDialogs,
  }, tabId);
});

addActionHandler('dismissDialog', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const newDialogs = [...selectTabState(global, tabId).dialogs];

  newDialogs.pop();

  return updateTabState(global, {
    dialogs: newDialogs,
  }, tabId);
});

addActionHandler('toggleSafeLinkModal', (global, actions, payload): ActionReturnType => {
  const { url: safeLinkModalUrl, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    safeLinkModalUrl,
  }, tabId);
});

addActionHandler('openHistoryCalendar', (global, actions, payload): ActionReturnType => {
  const { selectedAt, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    historyCalendarSelectedAt: selectedAt,
  }, tabId);
});

addActionHandler('closeHistoryCalendar', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    historyCalendarSelectedAt: undefined,
  }, tabId);
});

addActionHandler('requestConfetti', (global, actions, payload): ActionReturnType => {
  const {
    tabId = getCurrentTabId(), ...rest
  } = payload;

  if (!selectCanAnimateInterface(global)) return undefined;

  return updateTabState(global, {
    confetti: {
      lastConfettiTime: Date.now(),
      ...rest,
    },
  }, tabId);
});

addActionHandler('requestWave', (global, actions, payload): ActionReturnType => {
  const {
    startX, startY, tabId = getCurrentTabId(),
  } = payload;

  if (!IS_WAVE_TRANSFORM_SUPPORTED || !selectCanAnimateInterface(global)) return undefined;

  const tabState = selectTabState(global, tabId);
  const currentLastTime = tabState.wave?.lastWaveTime || 0;
  if (Date.now() - currentLastTime < ANIMATION_WAVE_MIN_INTERVAL) return undefined;

  return updateTabState(global, {
    wave: {
      lastWaveTime: Date.now(),
      startX,
      startY,
    },
  }, tabId);
});

addActionHandler('updateAttachmentSettings', (global, actions, payload): ActionReturnType => {
  return {
    ...global,
    attachmentSettings: {
      ...global.attachmentSettings,
      ...payload,
    },
  };
});

addActionHandler('updateShouldSaveAttachmentsCompression', (global, actions, payload): ActionReturnType => {
  const { shouldSave, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    shouldSaveAttachmentsCompression: shouldSave,
  }, tabId);
});

addActionHandler('applyDefaultAttachmentsCompression', (global): ActionReturnType => {
  const { defaultAttachmentCompression } = global.attachmentSettings;
  const shouldCompress = defaultAttachmentCompression === 'compress';

  return {
    ...global,
    attachmentSettings: {
      ...global.attachmentSettings,
      shouldCompress,
    },
  };
});

addActionHandler('openLimitReachedModal', (global, actions, payload): ActionReturnType => {
  const { limit, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    limitReachedModal: {
      limit,
    },
  }, tabId);
});

addActionHandler('closeLimitReachedModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    limitReachedModal: undefined,
  }, tabId);
});

addActionHandler('closeStickerSetModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    openedStickerSetShortName: undefined,
  }, tabId);
});

addActionHandler('openCustomEmojiSets', (global, actions, payload): ActionReturnType => {
  const { setIds, tabId = getCurrentTabId() } = payload;
  return updateTabState(global, {
    openedCustomEmojiSetIds: setIds,
  }, tabId);
});

addActionHandler('closeCustomEmojiSets', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    openedCustomEmojiSetIds: undefined,
  }, tabId);
});

addActionHandler('updateLastRenderedCustomEmojis', (global, actions, payload): ActionReturnType => {
  const { ids } = payload;
  const { lastRendered } = global.customEmojis;

  return {
    ...global,
    customEmojis: {
      ...global.customEmojis,
      lastRendered: unique([...lastRendered, ...ids]).slice(0, GLOBAL_STATE_CACHE_CUSTOM_EMOJI_LIMIT),
    },
  };
});

addActionHandler('updateArchiveSettings', (global, actions, payload): ActionReturnType => {
  const { archiveSettings } = global;
  const { isHidden = archiveSettings.isHidden, isMinimized = archiveSettings.isMinimized } = payload;

  return {
    ...global,
    archiveSettings: {
      isHidden,
      isMinimized,
    },
  };
});

addActionHandler('checkAppVersion', (global): ActionReturnType => {
  fetch(`${APP_VERSION_URL}?${Date.now()}`)
    .then((response) => response.text())
    .then((version) => {
      version = version.trim();

      if (getIsAppUpdateNeeded(version, APP_VERSION)) {
        global = getGlobal();
        global = {
          ...global,
          isAppUpdateAvailable: true,
        };
        setGlobal(global);
      }
    })
    .catch((err) => {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.error('[checkAppVersion failed] ', err);
      }
    });
});

let notificationInterval: number | undefined;

const NOTIFICATION_INTERVAL = 500;

addActionHandler('onTabFocusChange', (global, actions, payload): ActionReturnType => {
  const { isBlurred, tabId = getCurrentTabId() } = payload;

  if (isBlurred) {
    if (notificationInterval) clearInterval(notificationInterval);

    notificationInterval = window.setInterval(() => {
      actions.updatePageTitle({
        tabId,
      });
    }, NOTIFICATION_INTERVAL);
  } else {
    clearInterval(notificationInterval);
    notificationInterval = undefined;
  }

  global = updateTabState(global, {
    isBlurred,
  }, tabId);

  return {
    ...global,
    initialUnreadNotifications: isBlurred ? getAllNotificationsCount() : undefined,
  };
});

addActionHandler('updatePageTitle', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const { canDisplayChatInTitle } = selectSharedSettings(global);
  const currentUserId = global.currentUserId;

  const defaultTitle = IS_TAURI ? PAGE_TITLE_TAURI : PAGE_TITLE;

  const lang = getTranslationFn();
  if (selectTabState(global, tabId).inactiveReason) {
    updateIcon(false);
    setPageTitleInstant(`${defaultTitle} ${lang('PageTitleInactive')}`);
    return;
  }

  // Show blinking title in browser tab
  if (!IS_TAURI && global.initialUnreadNotifications && Math.round(Date.now() / 1000) % 2 === 0) {
    const notificationCount = getAllNotificationsCount();

    const newUnread = notificationCount - global.initialUnreadNotifications;

    if (newUnread > 0) {
      const notificationsTitle = lang('PageTitleNotifications', { count: newUnread }, { pluralValue: newUnread });
      setPageTitleInstant(notificationsTitle);
      updateIcon(true);
      return;
    }
  }

  updateIcon(false);

  const messageList = selectCurrentMessageList(global, tabId);

  if (messageList && canDisplayChatInTitle && !global.passcode.isScreenLocked) {
    const { chatId } = messageList;
    const currentChat = selectChat(global, chatId);
    if (currentChat) {
      const title = getChatTitle(getTranslationFn(), currentChat, chatId === currentUserId);
      setPageTitle(title);
      return;
    }
  }

  setPageTitleInstant(defaultTitle);
});

addActionHandler('closeInviteViaLinkModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload ?? {};
  return updateTabState(global, {
    inviteViaLinkModal: undefined,
  }, tabId);
});

addActionHandler('openQrCodeModal', (global, actions, payload): ActionReturnType => {
  const { peerId, tabId = getCurrentTabId() } = payload;
  return updateTabState(global, {
    qrCodeModal: {
      peerId,
    },
  }, tabId);
});

addTabStateResetterAction('closeQrCodeModal', 'qrCodeModal');

addActionHandler('openBirthdaySetupModal', (global, actions, payload): ActionReturnType => {
  const {
    currentBirthday, suggestForUserId, isFromSuggestion, tabId = getCurrentTabId(),
  } = payload || {};
  return updateTabState(global, {
    birthdaySetupModal: {
      currentBirthday,
      suggestForUserId,
      isFromSuggestion,
    },
  }, tabId);
});

addTabStateResetterAction('closeBirthdaySetupModal', 'birthdaySetupModal');

addActionHandler('setShouldCloseRightColumn', (global, actions, payload): ActionReturnType => {
  const { value, tabId = getCurrentTabId() } = payload;
  return updateTabState(global, {
    shouldCloseRightColumn: value,
  }, tabId);
});

let prevIsScreenLocked: boolean | undefined;
let prevBlurredTabsCount: number = 0;
let onlineTimeout: number | undefined;
const ONLINE_TIMEOUT = 100;
addCallback((global: GlobalState) => {
  const { updatePageTitle, updateIsOnline } = getActions();

  const isLockedUpdated = global.passcode.isScreenLocked !== prevIsScreenLocked;
  const blurredTabsCount = Object.values(global.byTabId).filter((l) => l.isBlurred).length;
  const isMasterTab = selectTabState(global, getCurrentTabId()).isMasterTab;

  if (isLockedUpdated) {
    updatePageTitle();
  }

  if (blurredTabsCount !== prevBlurredTabsCount && isMasterTab) {
    if (onlineTimeout) clearTimeout(onlineTimeout);

    onlineTimeout = window.setTimeout(() => {
      global = getGlobal();
      const newBlurredTabsCount = Object.values(global.byTabId).filter((l) => l.isBlurred).length;
      updateIsOnline({ isOnline: newBlurredTabsCount !== getAllMultitabTokens().length });
    }, ONLINE_TIMEOUT);
  }

  prevIsScreenLocked = global.passcode.isScreenLocked;
  prevBlurredTabsCount = blurredTabsCount;
});

addActionHandler('openAutoDeleteTimerModal', (global, actions, payload): ActionReturnType => {
  const { chatId, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    autoDeleteTimerModal: { chatId },
  }, tabId);
});

addTabStateResetterAction('closeAutoDeleteTimerModal', 'autoDeleteTimerModal');

addActionHandler('openQuickChatPicker', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    isQuickChatPickerOpen: true,
  }, tabId);
});

addTabStateResetterAction('closeQuickChatPicker', 'isQuickChatPickerOpen');

addActionHandler('requestMessageMediaEditor', (global, actions, payload): ActionReturnType => {
  const {
    chatId, messageId, videoTime, tabId = getCurrentTabId(),
  } = payload;

  const message = selectChatMessage(global, chatId, messageId);
  if (!message || !canEditMediaInEditor(message)) return;

  return updateTabState(global, {
    messageMediaEditorRequest: {
      chatId: message.chatId,
      messageId: message.id,
      videoTime,
    },
  }, tabId);
});

addTabStateResetterAction('resetMessageMediaEditorRequest', 'messageMediaEditorRequest');
