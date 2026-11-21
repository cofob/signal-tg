import type {
  ApiChatTheme, ApiPrivacySettings, ApiSignalPinSettings,
} from '../../../api/types';
import type { ThemeKey } from '../../../types';
import type { ActionReturnType } from '../../types';
import {
  LeftColumnContent,
  ProfileEditProgress,
  UPLOADING_WALLPAPER_SLUG,
} from '../../../types';

import {
  APP_CONFIG_REFETCH_INTERVAL,
  COUNTRIES_WITH_12H_TIME_FORMAT,
  MUTE_INDEFINITE_TIMESTAMP,
  UNMUTE_TIMESTAMP,
} from '../../../config';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { fetchBuiltInLanguages, getTranslationFn, loadAndChangeLanguage } from '../../../util/localization';
import { requestPermission } from '../../../util/notifications';
import { refreshPushNotificationState, suspendPushForPasscode } from '../../../util/pushNotifications';
import requestActionTimeout from '../../../util/requestActionTimeout';
import { getServerTime } from '../../../util/serverTime';
import { runSettingsAction } from '../../../util/settingsActions';
import { resolveSettingsLink } from '../../../util/settingsLinks';
import { getChatThemeEntry, RESET_WALLPAPER_SETTINGS } from '../../../util/wallpaper';
import { callApi } from '../../../api';
import { buildApiInputPrivacyRules } from '../../helpers';
import {
  addActionHandler, getActions, getGlobal, getPromiseActions, setGlobal,
} from '../../index';
import {
  addBlockedUser, addNotifyExceptions, deletePeerPhoto,
  removeBlockedUser, replacePersonalChannelIds, replacePrivacySettings, replaceSettings,
  updateNotifyDefaults, updateSharedSettings, updateThemeSettings, updateUser, updateUserFullInfo,
  updateUsernameEdit,
} from '../../reducers';
import { updateTabState } from '../../reducers/tabs';
import { selectCurrentMessageList, selectIsCurrentUserFrozen,
  selectLanguageCode,
  selectPeer,
  selectTabState, selectUser,
} from '../../selectors';
import { selectSharedSettings } from '../../selectors/sharedState';

let languageSelectionRequestId = 0;
let languageModalRequestId = 0;

addActionHandler('updateProfile', async (global, actions, payload): Promise<void> => {
  const {
    photo, shouldRemovePhoto, firstName, lastName, bio, tabId = getCurrentTabId(),
  } = payload;

  global = updateTabState(global, {
    profileEdit: {
      progress: ProfileEditProgress.InProgress,
    },
  }, tabId);
  setGlobal(global);

  const result = await callApi('updateOwnProfile', {
    firstName, lastName, bio, photo: photo?.file, shouldRemovePhoto,
  });
  if (!result) actions.showNotification({ message: { key: 'SignalProfileSaveFailed' }, tabId });

  global = getGlobal();
  global = updateTabState(global, {
    profileEdit: {
      progress: result ? ProfileEditProgress.Complete : ProfileEditProgress.Idle,
    },
  }, tabId);
  setGlobal(global);
});

// Results of earlier reservations that arrive late are dropped, so the screen shows the latest input's
let usernameReservationRequestId = 0;

addActionHandler('reserveUsername', async (global, actions, payload): Promise<void> => {
  const { nickname, discriminator, tabId = getCurrentTabId() } = payload;
  const requestId = ++usernameReservationRequestId;

  global = updateUsernameEdit(global, { reservedUsername: undefined, isReserving: true, error: undefined }, tabId);
  setGlobal(global);

  const result = await callApi('reserveUsername', { nickname, discriminator });
  if (requestId !== usernameReservationRequestId) return;

  global = getGlobal();
  global = updateUsernameEdit(global, {
    isReserving: undefined,
    reservedUsername: result && 'username' in result ? result.username : undefined,
    error: result && 'error' in result ? result.error : undefined,
  }, tabId);
  setGlobal(global);
});

addActionHandler('confirmUsername', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  const username = selectTabState(global, tabId).usernameEdit?.reservedUsername;
  if (!username) return;

  global = updateUsernameEdit(global, { isSaving: true }, tabId);
  setGlobal(global);

  const result = await callApi('confirmUsername', { username });
  const isSaved = Boolean(result && 'username' in result);
  const link = isSaved ? await callApi('fetchUsernameLink') : undefined;

  global = getGlobal();
  global = updateUsernameEdit(global, {
    isSaving: undefined,
    reservedUsername: isSaved ? undefined : username,
    error: result && 'error' in result ? result.error : undefined,
    link: isSaved ? link : selectTabState(global, tabId).usernameEdit?.link,
  }, tabId);
  setGlobal(global);
});

addActionHandler('deleteUsername', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  const result = await callApi('deleteUsername');
  if (!result) {
    actions.showNotification({ message: { key: 'SignalUsernameFailed' }, tabId });
    return;
  }

  global = getGlobal();
  global = updateTabState(global, { usernameEdit: {} }, tabId);
  setGlobal(global);
});

addActionHandler('loadUsernameLink', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  const link = await callApi('fetchUsernameLink');

  global = getGlobal();
  global = updateUsernameEdit(global, { link }, tabId);
  setGlobal(global);
});

addActionHandler('resetUsernameLink', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  const link = await callApi('resetUsernameLink');
  if (!link) {
    actions.showNotification({ message: { key: 'SignalUsernameFailed' }, tabId });
    return;
  }

  global = getGlobal();
  global = updateUsernameEdit(global, { link }, tabId);
  setGlobal(global);
  actions.showNotification({ message: { key: 'SignalUsernameLinkResetDone' }, tabId });
});

addActionHandler('resetUsernameEdit', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const { link } = selectTabState(global, tabId).usernameEdit || {};
  return updateTabState(global, { usernameEdit: { link } }, tabId);
});

addActionHandler('loadPhoneNumberPrivacy', async (global): Promise<void> => {
  const result = await callApi('fetchPhoneNumberPrivacy');
  if (!result) return;

  global = getGlobal();
  global = replacePrivacySettings(global, result);
  setGlobal(global);
});

addActionHandler('updatePhoneNumberPrivacy', async (global, actions, payload): Promise<void> => {
  const { isShared, isDiscoverable, tabId = getCurrentTabId() } = payload;
  const result = await callApi('updatePhoneNumberPrivacy', { isShared, isDiscoverable });
  if (!result) {
    actions.showNotification({ message: { key: 'SignalProfileSaveFailed' }, tabId });
    return;
  }

  global = getGlobal();
  global = replacePrivacySettings(global, result);
  setGlobal(global);
});

addActionHandler('loadPersonalChannels', async (global): Promise<void> => {
  const personalChannelIds = await callApi('fetchAdminedPersonalChannelIds');
  if (!personalChannelIds) return;

  global = getGlobal();
  global = replacePersonalChannelIds(global, personalChannelIds);
  setGlobal(global);
});

addActionHandler('updateBirthday', async (global, actions, payload): Promise<void> => {
  const { birthday } = payload;
  const { currentUserId } = global;
  if (!currentUserId) return;

  const result = await callApi('updateBirthday', birthday);
  if (!result) return;

  actions.loadFullUser({ userId: currentUserId });
});

addActionHandler('updateProfilePhoto', async (global, actions, payload): Promise<void> => {
  const { photo, isFallback } = payload;
  const { currentUserId } = global;
  if (!currentUserId) return;
  const currentUser = selectUser(global, currentUserId);
  if (!currentUser) return;

  global = updateUser(global, currentUserId, { avatarPhotoId: undefined });
  global = updateUserFullInfo(global, currentUserId, { profilePhoto: undefined });

  setGlobal(global);

  const result = await callApi('updateProfilePhoto', photo, isFallback);
  if (!result) return;

  actions.loadFullUser({ userId: currentUserId, withPhotos: true });
});

addActionHandler('deleteProfilePhoto', async (global, actions, payload): Promise<void> => {
  const { photo } = payload;
  const { currentUserId } = global;
  if (!currentUserId) return;

  const isDeleted = await callApi('deleteProfilePhotos', [photo]);
  if (!isDeleted) return;

  global = getGlobal();
  global = deletePeerPhoto(global, currentUserId, photo.id);
  setGlobal(global);

  actions.loadFullUser({ userId: currentUserId, withPhotos: true });
});

addActionHandler('loadWallpapers', async (global): Promise<void> => {
  const result = await callApi('fetchWallpapers');
  if (!result) {
    return;
  }

  global = getGlobal();
  global = {
    ...global,
    settings: {
      ...global.settings,
      loadedWallpapers: result.wallpapers,
    },
  };
  setGlobal(global);
});

addActionHandler('loadChatThemes', async (global): Promise<void> => {
  const result = await callApi('fetchChatThemes');
  if (!result) {
    return;
  }

  global = getGlobal();
  global = {
    ...global,
    settings: {
      ...global.settings,
      chatThemes: result.chatThemes,
    },
  };
  CHAT_THEME_KEYS.forEach((theme) => {
    const emoticon = selectSharedSettings(global).themes[theme]?.chatThemeEmoticon;
    const chatTheme = result.chatThemes.find((entry: ApiChatTheme) => entry.emoticon === emoticon);
    global = updateThemeSettings(global, theme, {
      chatThemeEmoticon: chatTheme?.emoticon,
      serverThemeSettings: chatTheme && getChatThemeEntry(chatTheme.settings, theme === 'dark'),
    });
  });
  setGlobal(global);
});

const CHAT_THEME_KEYS: ThemeKey[] = ['light', 'dark'];

addActionHandler('applyChatTheme', (global, actions, payload): ActionReturnType => {
  const { emoticon, isSignalTheme, tabId = getCurrentTabId() } = payload;
  const chatTheme = global.settings.chatThemes?.find((theme) => theme.emoticon === emoticon);
  if (emoticon && !chatTheme) return global;

  CHAT_THEME_KEYS.forEach((theme) => {
    global = updateThemeSettings(global, theme, {
      ...RESET_WALLPAPER_SETTINGS,
      chatThemeEmoticon: emoticon,
      serverThemeSettings: chatTheme && getChatThemeEntry(chatTheme.settings, theme === 'dark'),
      isSignalTheme,
    });
  });
  return updateTabState(global, {
    globalThemePreviewChatId: selectCurrentMessageList(global, tabId)?.chatId,
  }, tabId);
});

addActionHandler('uploadWallpaper', async (global, actions, payload): Promise<void> => {
  const file = payload;
  const previewBlobUrl = URL.createObjectURL(file);

  global = {
    ...global,
    settings: {
      ...global.settings,
      loadedWallpapers: [
        {
          slug: UPLOADING_WALLPAPER_SLUG,
          document: {
            mediaType: 'document',
            fileName: '',
            size: file.size,
            mimeType: file.type,
            previewBlobUrl,
          },
        },
        ...(global.settings.loadedWallpapers || []),
      ],
    },
  };
  setGlobal(global);

  const result = await callApi('uploadWallpaper', file);
  if (!result) {
    return;
  }

  const { wallpaper } = result;

  global = getGlobal();
  if (!global.settings.loadedWallpapers) {
    return;
  }

  const firstWallpaper = global.settings.loadedWallpapers[0];
  if (!firstWallpaper || firstWallpaper.slug !== UPLOADING_WALLPAPER_SLUG || !wallpaper.document) {
    return;
  }

  const withLocalMedia = {
    ...wallpaper,
    document: {
      ...wallpaper.document,
      previewBlobUrl,
    },
  };

  global = {
    ...global,
    settings: {
      ...global.settings,
      loadedWallpapers: [
        withLocalMedia,
        ...global.settings.loadedWallpapers.slice(1),
      ],
    },
  };
  setGlobal(global);
});

addActionHandler('loadBlockedUsers', async (global): Promise<void> => {
  const result = await callApi('fetchBlockedUsers', {});
  if (!result) return;

  global = getGlobal();

  global = {
    ...global,
    blocked: {
      ids: result.blockedIds,
      totalCount: result.totalCount,
    },
  };

  setGlobal(global);
});

addActionHandler('blockUser', async (global, actions, payload): Promise<void> => {
  const { userId, isOnlyStories } = payload;

  // Signal blocks groups too
  const user = selectPeer(global, userId);
  if (!user) return;

  const result = await callApi('blockUser', {
    user,
    isOnlyStories: isOnlyStories || undefined,
  });
  if (!result) return;

  global = getGlobal();
  global = addBlockedUser(global, userId);
  setGlobal(global);
});

addActionHandler('unblockUser', async (global, actions, payload): Promise<void> => {
  const { userId, isOnlyStories } = payload;

  // Signal blocks groups too
  const user = selectPeer(global, userId);
  if (!user) return;

  const result = await callApi('unblockUser', {
    user,
    isOnlyStories: isOnlyStories || undefined,
  });
  if (!result) return;

  global = getGlobal();
  global = removeBlockedUser(global, userId);
  setGlobal(global);
});

addActionHandler('loadNotificationExceptions', async (global): Promise<void> => {
  const result = await callApi('fetchNotificationExceptions');
  if (!result) {
    return;
  }

  global = getGlobal();
  global = addNotifyExceptions(global, result);
  setGlobal(global);
});

addActionHandler('loadNotificationSettings', async (global): Promise<void> => {
  const [signUpNotification, notifyDefaults] = await Promise.all([
    callApi('fetchContactSignUpSetting'),
    callApi('fetchNotifyDefaultSettings'),
  ]);

  if (!notifyDefaults) return;

  global = getGlobal();
  global = replaceSettings(global, {
    hasContactJoinedNotifications: signUpNotification,
  });
  global = {
    ...global,
    settings: {
      ...global.settings,
      notifyDefaults,
    },
  };
  setGlobal(global);
});

addActionHandler('updateNotificationSettings', async (global, actions, payload): Promise<void> => {
  const { peerType, isMuted, shouldShowPreviews } = payload;

  const result = await callApi('updateNotificationSettings', peerType, { isMuted, shouldShowPreviews });
  if (!result) {
    return;
  }

  global = getGlobal();
  global = updateNotifyDefaults(global, peerType, {
    mutedUntil: isMuted ? MUTE_INDEFINITE_TIMESTAMP : UNMUTE_TIMESTAMP,
    shouldShowPreviews,
  });
  setGlobal(global);
});

addActionHandler('updateWebNotificationSettings', async (global, actions, payload): Promise<void> => {
  const oldSettings = global.settings.byKey;
  global = replaceSettings(global, payload);
  setGlobal(global);
  const { hasWebNotifications } = global.settings.byKey;
  if (oldSettings.shouldShowPushPreviewsWhenLocked !== global.settings.byKey.shouldShowPushPreviewsWhenLocked) {
    if (global.passcode.hasPasscode && !global.settings.byKey.shouldShowPushPreviewsWhenLocked) {
      await suspendPushForPasscode(true);
    }
    await refreshPushNotificationState();
  }
  if (!oldSettings.hasWebNotifications && hasWebNotifications) {
    const isGranted = await requestPermission();
    if (!isGranted) {
      global = getGlobal();
      global = replaceSettings(global, { hasWebNotifications: false });
      setGlobal(global);
    }
  }
});

addActionHandler('updateContactSignUpNotification', async (global, actions, payload): Promise<void> => {
  const { isSilent } = payload;

  const result = await callApi('updateContactSignUpNotification', isSilent);
  if (!result) {
    return;
  }

  global = getGlobal();
  global = replaceSettings(global, { hasContactJoinedNotifications: !isSilent });
  setGlobal(global);
});

addActionHandler('loadLanguages', async (global): Promise<void> => {
  const languages = await fetchBuiltInLanguages();

  global = getGlobal();
  global = updateSharedSettings(global, { languages });
  setGlobal(global);
});

addActionHandler('openLanguageModal', async (global, actions, payload): Promise<void> => {
  const { langCode, tabId = getCurrentTabId() } = payload;
  const requestId = ++languageModalRequestId;
  const modal = { langCode, isLoading: true, requestId };
  global = updateTabState(global, { languageModal: modal }, tabId);
  setGlobal(global);

  const languages = await fetchBuiltInLanguages();
  const language = languages.find((item) => item.langCode === langCode);
  const error = language ? undefined : 'unsupported';

  global = getGlobal();
  if (selectTabState(global, tabId).languageModal?.requestId !== requestId) return;
  global = updateTabState(global, { languageModal: { requestId, langCode, language, error } }, tabId);
  setGlobal(global);
});

addActionHandler('applyLanguage', async (global, actions, payload): Promise<void> => {
  const { language, tabId = getCurrentTabId() } = payload;
  if (language.stringsCount === 0) return;
  const requestId = ++languageSelectionRequestId;

  const modal = selectTabState(global, tabId).languageModal;
  const applyingModal = modal?.language?.langCode === language.langCode
    ? { ...modal, isApplying: true } : undefined;
  if (applyingModal) {
    global = updateTabState(global, { languageModal: applyingModal }, tabId);
    setGlobal(global);
  }

  const hasChanged = await loadAndChangeLanguage(language.langCode);
  global = getGlobal();
  if (hasChanged && getTranslationFn().rawCode === language.langCode) {
    const settings = selectSharedSettings(global);
    const appliedLanguage = getTranslationFn().languageInfo!;
    global = updateSharedSettings(global, {
      language: language.langCode,
      customLanguages: !language.isOfficial
        ? [appliedLanguage, ...settings.customLanguages?.filter(({ langCode }) => langCode !== language.langCode) || []]
        : settings.customLanguages,
    });
  } else if (requestId === languageSelectionRequestId) {
    actions.showNotification({ message: { key: 'LanguageLoadFailed' }, tabId });
  }

  if (applyingModal && selectTabState(global, tabId).languageModal?.requestId === applyingModal.requestId) {
    global = updateTabState(global, {
      languageModal: hasChanged ? undefined : { ...applyingModal, isApplying: undefined },
    }, tabId);
  }
  setGlobal(global);
});

addActionHandler('loadPrivacySettings', async (global, actions, payload): Promise<void> => {
  const { skipIfCached } = payload;
  if (skipIfCached && Object.keys(global.settings.privacy).length > 0) {
    return;
  }

  if (selectIsCurrentUserFrozen(global)) return;

  const result = await Promise.all([
    callApi('fetchPrivacySettings', 'phoneNumber'),
    callApi('fetchPrivacySettings', 'addByPhone'),
    callApi('fetchPrivacySettings', 'lastSeen'),
    callApi('fetchPrivacySettings', 'profilePhoto'),
    callApi('fetchPrivacySettings', 'forwards'),
    callApi('fetchPrivacySettings', 'chatInvite'),
    callApi('fetchPrivacySettings', 'phoneCall'),
    callApi('fetchPrivacySettings', 'phoneP2P'),
    callApi('fetchPrivacySettings', 'voiceMessages'),
    callApi('fetchPrivacySettings', 'bio'),
    callApi('fetchPrivacySettings', 'birthday'),
    callApi('fetchPrivacySettings', 'savedMusic'),
  ]);

  if (result.some((e) => e === undefined)) {
    return;
  }

  const [
    phoneNumberSettings,
    addByPhoneSettings,
    lastSeenSettings,
    profilePhotoSettings,
    forwardsSettings,
    chatInviteSettings,
    phoneCallSettings,
    phoneP2PSettings,
    voiceMessagesSettings,
    bioSettings,
    birthdaySettings,
    savedMusicSettings,
  ] = result as {
    rules: ApiPrivacySettings;
  }[];

  global = getGlobal();
  global = {
    ...global,
    settings: {
      ...global.settings,
      privacy: {
        ...global.settings.privacy,
        phoneNumber: phoneNumberSettings.rules,
        addByPhone: addByPhoneSettings.rules,
        lastSeen: lastSeenSettings.rules,
        profilePhoto: profilePhotoSettings.rules,
        forwards: forwardsSettings.rules,
        chatInvite: chatInviteSettings.rules,
        phoneCall: phoneCallSettings.rules,
        phoneP2P: phoneP2PSettings.rules,
        voiceMessages: voiceMessagesSettings.rules,
        bio: bioSettings.rules,
        birthday: birthdaySettings.rules,
        savedMusic: savedMusicSettings.rules,
      },
    },
  };
  setGlobal(global);
});

addActionHandler('setPrivacyVisibility', async (global, actions, payload): Promise<void> => {
  const { privacyKey, visibility, onSuccess } = payload;

  if (!global.settings.privacy[privacyKey]) {
    const result = await callApi('fetchPrivacySettings', privacyKey);
    if (!result) {
      return;
    }

    global = getGlobal();
    global = {
      ...global,
      settings: {
        ...global.settings,
        privacy: {
          ...global.settings.privacy,
          [privacyKey]: result.rules,
        },
      },
    };
    setGlobal(global);
  }

  const {
    privacy: { [privacyKey]: settings },
  } = global.settings;

  if (!settings) {
    return;
  }

  const rules = buildApiInputPrivacyRules(global, {
    visibility,
    allowedIds: [...settings.allowUserIds, ...settings.allowChatIds],
    blockedIds: [...settings.blockUserIds, ...settings.blockChatIds],
  });

  const result = await callApi('setPrivacySettings', privacyKey, rules);
  if (!result) {
    return;
  }

  onSuccess?.();

  global = getGlobal();
  global = {
    ...global,
    settings: {
      ...global.settings,
      privacy: {
        ...global.settings.privacy,
        [privacyKey]: result.rules,
      },
    },
  };
  setGlobal(global);
});

addActionHandler('setPrivacySettings', async (global, actions, payload): Promise<void> => {
  const {
    privacyKey, isAllowList, updatedIds,
  } = payload;
  const {
    privacy: { [privacyKey]: settings },
  } = global.settings;

  if (!settings) {
    return;
  }

  const rules = buildApiInputPrivacyRules(global, {
    visibility: settings.visibility,
    isUnspecified: settings.isUnspecified,
    allowedIds: isAllowList ? updatedIds : [...settings.allowUserIds, ...settings.allowChatIds],
    blockedIds: !isAllowList ? updatedIds : [...settings.blockUserIds, ...settings.blockChatIds],
  });

  const result = await callApi('setPrivacySettings', privacyKey, rules);
  if (!result) {
    return;
  }

  global = getGlobal();
  global = {
    ...global,
    settings: {
      ...global.settings,
      privacy: {
        ...global.settings.privacy,
        [privacyKey]: result.rules,
      },
    },
  };
  setGlobal(global);
});

addActionHandler('updateIsOnline', (global, actions, payload): ActionReturnType => {
  if (global.connectionState !== 'connectionStateReady') return;
  callApi('updateIsOnline', payload.isOnline);
});

addActionHandler('loadContentSettings', async (global): Promise<void> => {
  if (selectIsCurrentUserFrozen(global)) return;

  const result = await callApi('fetchContentSettings');
  if (!result) return;

  global = getGlobal();
  global = replaceSettings(global, result);
  setGlobal(global);
});

addActionHandler('updateContentSettings', async (global, actions, payload): Promise<void> => {
  global = replaceSettings(global, { isSensitiveEnabled: payload.isSensitiveEnabled });
  setGlobal(global);

  const result = await callApi('updateContentSettings', payload.isSensitiveEnabled);
  if (!result) {
    global = getGlobal();
    global = replaceSettings(global, { isSensitiveEnabled: !payload.isSensitiveEnabled });
    setGlobal(global);
  }
});

addActionHandler('loadCountryList', async (global, actions, payload): Promise<void> => {
  let { langCode } = payload;
  if (!langCode) langCode = selectLanguageCode(global);

  const countryList = await callApi('fetchCountryList', { langCode });
  if (!countryList) return;

  global = getGlobal();
  global = {
    ...global,
    countryList,
  };
  setGlobal(global);
});

addActionHandler('ensureTimeFormat', async (global, actions): Promise<void> => {
  if (global.auth.nearestCountry) {
    const timeFormat = COUNTRIES_WITH_12H_TIME_FORMAT
      .has(global.auth.nearestCountry.toUpperCase()) ? '12h' : '24h';
    actions.setSharedSettingOption({ timeFormat });
  }

  if (selectSharedSettings(global).wasTimeFormatSetManually) {
    return;
  }

  const nearestCountryCode = await callApi('fetchNearestCountry');
  if (nearestCountryCode) {
    const timeFormat = COUNTRIES_WITH_12H_TIME_FORMAT.has(nearestCountryCode.toUpperCase()) ? '12h' : '24h';
    actions.setSharedSettingOption({ timeFormat });
  }
});

addActionHandler('loadAppConfig', async (global, actions, payload): Promise<void> => {
  const hash = payload?.hash;

  const appConfig = await callApi('fetchAppConfig', { hash });
  if (!appConfig) return;

  requestActionTimeout({
    action: 'loadAppConfig',
    payload: { hash: appConfig.hash },
  }, APP_CONFIG_REFETCH_INTERVAL);

  global = getGlobal();
  global = {
    ...global,
    appConfig,
    isAppConfigLoaded: true,
  };
  setGlobal(global);
});

addActionHandler('loadConfig', async (global): Promise<void> => {
  const config = await callApi('fetchConfig');
  if (!config) return;

  global = getGlobal();
  const timeout = config.expiresAt - getServerTime();
  requestActionTimeout({
    action: 'loadConfig',
    payload: undefined,
  }, timeout * 1000);

  global = {
    ...global,
    config,
  };
  setGlobal(global);
});

addActionHandler('loadPromoData', async (global): Promise<void> => {
  const promoData = await callApi('fetchPromoData');

  global = getGlobal();
  const timeout = (promoData?.expires || 0) - getServerTime();
  if (timeout > 0) {
    requestActionTimeout({
      action: 'loadPromoData',
      payload: undefined,
    }, timeout * 1000);
  }

  global = {
    ...global,
    promoData,
  };
  setGlobal(global);
});

addActionHandler('dismissSuggestion', async (global, actions, payload): Promise<void> => {
  const { suggestion } = payload;
  await callApi('dismissSuggestion', suggestion);

  actions.loadPromoData();
});

addActionHandler('loadPeerColors', async (global): Promise<void> => {
  const profileHash = global.peerColors?.profileHash;
  const [generalResult, profileResult] = await Promise.all([
    callApi('fetchPeerColors'),
    callApi('fetchPeerProfileColors', profileHash),
  ]);

  if (!generalResult && !profileResult) return;

  global = getGlobal();

  const currentPeerColors = global.peerColors! || {};

  global = {
    ...global,
    peerColors: {
      ...currentPeerColors,
      general: generalResult?.colors || currentPeerColors.general,
      generalHash: generalResult?.hash || currentPeerColors.generalHash,
      profile: profileResult?.colors || currentPeerColors.profile,
      profileHash: profileResult?.hash || currentPeerColors.profileHash,
    },
  };
  setGlobal(global);
});

addActionHandler('loadGlobalPrivacySettings', async (global): Promise<void> => {
  const globalSettings = await callApi('fetchGlobalPrivacySettings');
  if (!globalSettings) {
    return;
  }

  global = getGlobal();
  global = replaceSettings(global, { ...globalSettings });
  setGlobal(global);
});

addActionHandler('loadDefaultHistoryTtl', async (global): Promise<void> => {
  const defaultHistoryTtl = await callApi('fetchDefaultHistoryTtl');
  if (defaultHistoryTtl === undefined) return;

  global = getGlobal();
  global = replaceSettings(global, { defaultHistoryTtl });
  setGlobal(global);
});

addActionHandler('setDefaultHistoryTtl', async (global, _actions, payload): Promise<void> => {
  const { period } = payload;
  const result = await callApi('setDefaultHistoryTtl', { period });
  if (!result) return;

  global = getGlobal();
  global = replaceSettings(global, { defaultHistoryTtl: period });
  setGlobal(global);
});

addActionHandler('updateGlobalPrivacySettings', async (global, actions, payload): Promise<void> => {
  const shouldArchiveAndMuteNewNonContact = payload.shouldArchiveAndMuteNewNonContact
    ?? Boolean(global.settings.byKey.shouldArchiveAndMuteNewNonContact);
  const shouldHideReadMarks = payload.shouldHideReadMarks ?? Boolean(global.settings.byKey.shouldHideReadMarks);

  global = getGlobal();
  global = replaceSettings(global, {
    shouldArchiveAndMuteNewNonContact,
    shouldHideReadMarks,
  });
  setGlobal(global);

  const result = await callApi('updateGlobalPrivacySettings', {
    shouldArchiveAndMuteNewNonContact,
    shouldHideReadMarks,
  });

  global = getGlobal();
  global = replaceSettings(global, {
    shouldArchiveAndMuteNewNonContact: !result
      ? !shouldArchiveAndMuteNewNonContact
      : result.shouldArchiveAndMuteNewNonContact,
    shouldHideReadMarks: !result ? !shouldHideReadMarks : result.shouldHideReadMarks,
  });

  setGlobal(global);
});

addActionHandler('loadSignalPinSettings', async (global): Promise<void> => {
  const signalPin = await callApi('fetchSignalPinSettings');
  global = getGlobal();
  global = replaceSettings(global, { signalPin });
  setGlobal(global);
});

addActionHandler('setSignalPin', async (global, actions, payload): Promise<void> => {
  const { pin, tabId = getCurrentTabId() } = payload;
  await applySignalPinChange(await callApi('setSignalPin', pin), tabId);
});

addActionHandler('removeSignalPin', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  await applySignalPinChange(await callApi('removeSignalPin'), tabId);
});

addActionHandler('setSignalRegistrationLock', async (global, actions, payload): Promise<void> => {
  const { isEnabled, tabId = getCurrentTabId() } = payload;
  await applySignalPinChange(await callApi('setSignalRegistrationLock', isEnabled), tabId);
});

addActionHandler('loadSignalContactDiscovery', async (global): Promise<void> => {
  const isSignalContactDiscoveryEnabled = await callApi('fetchSignalContactDiscovery');
  global = getGlobal();
  global = replaceSettings(global, { isSignalContactDiscoveryEnabled });
  setGlobal(global);
});

addActionHandler('setSignalContactDiscovery', async (global, actions, payload): Promise<void> => {
  const { isEnabled, tabId = getCurrentTabId() } = payload;
  const result = await callApi('setSignalContactDiscovery', isEnabled);
  if (result === undefined) {
    actions.showNotification({ message: { key: 'ErrorUnexpected' }, tabId });
    return;
  }
  global = getGlobal();
  global = replaceSettings(global, { isSignalContactDiscoveryEnabled: result });
  setGlobal(global);
});
addActionHandler('loadNestedSettingsData', async (global): Promise<void> => {
  const {
    loadBlockedUsers, loadDefaultHistoryTtl, loadGlobalPrivacySettings, loadSignalPinSettings,
    loadSignalContactDiscovery,
  } = getPromiseActions();

  const requests = [loadSignalPinSettings(), loadSignalContactDiscovery()];
  if (!selectIsCurrentUserFrozen(global)) {
    requests.push(loadBlockedUsers(), loadDefaultHistoryTtl(), loadGlobalPrivacySettings());
  }

  await Promise.all(requests);
});

addActionHandler('openSettingsLink', async (global, actions, payload): Promise<void> => {
  const { path, tabId = getCurrentTabId() } = payload;

  const target = resolveSettingsLink(global, path);
  if (target?.action) {
    runSettingsAction(target.action, tabId);
    return;
  }

  const openedScreen = target ? target.screen : selectTabState(global, tabId).leftColumn.settingsScreen;
  if (target) {
    actions.openSettingsScreen({ screen: target.screen, highlight: target.highlight, tabId });
  } else {
    actions.openLeftColumnContent({ contentKey: LeftColumnContent.Settings, tabId });
  }

  await getPromiseActions().loadNestedSettingsData();

  global = getGlobal();
  const { contentKey, settingsScreen } = selectTabState(global, tabId).leftColumn;
  if (contentKey !== LeftColumnContent.Settings || settingsScreen !== openedScreen) return;

  const loadedTarget = resolveSettingsLink(global, path);
  if (loadedTarget?.action) {
    runSettingsAction(loadedTarget.action, tabId);
    return;
  }

  if (!loadedTarget || loadedTarget.screen === openedScreen) return;

  actions.openSettingsScreen({ screen: loadedTarget.screen, highlight: loadedTarget.highlight, tabId });
});

/** Stores the PIN settings after a change, or reloads them and tells that the change failed */
async function applySignalPinChange(signalPin: ApiSignalPinSettings | undefined, tabId: number) {
  if (!signalPin) {
    getActions().showNotification({ message: { key: 'SignalPinErrorSave' }, tabId });
    await getPromiseActions().loadSignalPinSettings();
    return;
  }
  let global = getGlobal();
  global = replaceSettings(global, { signalPin });
  setGlobal(global);
}
