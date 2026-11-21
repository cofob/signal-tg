import type { selectSettingsSearchFlags } from '../../../../global/selectors';
import type { IconName } from '../../../../types/icons';
import type { RegularLangKey } from '../../../../types/language';
import type { IconBackdropColor } from '../../../gili/primitives/IconBackdrop';
import { SettingsScreens } from '../../../../types';

import { IS_TAURI } from '../../../../util/browser/globalEnvironment';
import { IS_IOS, IS_MAC_OS } from '../../../../util/browser/windowEnvironment';
import { unique } from '../../../../util/iteratees';
import { getIsKeyboardShortcutAvailable } from '../../../../util/keyboardShortcuts';
import { KEYBOARD_SHORTCUT_IDS, KEYBOARD_SHORTCUTS } from '../../../../util/keyboardShortcuts/registry';
import { CAN_PROTECT_CONTENT } from '../../../../util/tauri/desktopApp';

export type SettingsSearchFlag =
  'isDesktopLayout' | 'canSendWithKeyboard' | keyof ReturnType<typeof selectSettingsSearchFlags>;

export type SettingsSearchSection = {
  screen: SettingsScreens;
  parent: SettingsScreens;
  titleKey: RegularLangKey;
  aliasKey?: RegularLangKey;
  keywordsKey?: RegularLangKey;
  icon?: IconName;
  iconBg?: IconBackdropColor;
  requires?: SettingsSearchFlag;
  screenWhen?: {
    flag: SettingsSearchFlag;
    screen: SettingsScreens;
  };
};

type SettingsSearchEntry = {
  screen: SettingsScreens;
  titleKey: RegularLangKey;
  keywordsKey?: RegularLangKey;
  icon?: IconName;
  iconBg?: IconBackdropColor;
  requires?: SettingsSearchFlag;
  isSectionHeader?: boolean;
};

type EntryOptions = Omit<SettingsSearchEntry, 'screen' | 'titleKey'>;

const PRIVACY_VISIBILITY_SCREENS: [SettingsScreens, RegularLangKey][] = [
  [SettingsScreens.PrivacyLastSeen, 'LastSeenTitle'],
  [SettingsScreens.PrivacyProfilePhoto, 'PrivacyProfilePhotoTitle'],
  [SettingsScreens.PrivacyBio, 'PrivacyBioTitle'],
  [SettingsScreens.PrivacyBirthday, 'PrivacyBirthdayTitle'],
  [SettingsScreens.PrivacySavedMusic, 'PrivacyMusicTitle'],
  [SettingsScreens.PrivacyForwarding, 'PrivacyForwardsTitle'],
  [SettingsScreens.PrivacyPhoneCall, 'WhoCanCallMe'],
  [SettingsScreens.PrivacyVoiceMessages, 'PrivacyVoiceMessagesTitle'],
  [SettingsScreens.PrivacyGroupChats, 'WhoCanAddMe'],
];

export const SETTINGS_SEARCH_SECTIONS: SettingsSearchSection[] = [
  {
    screen: SettingsScreens.EditProfile,
    parent: SettingsScreens.Main,
    titleKey: 'SettingsInformation',
    aliasKey: 'SettingsAccount',
    icon: 'account-filled',
    iconBg: 'blue',
  },
  {
    screen: SettingsScreens.General,
    parent: SettingsScreens.Main,
    titleKey: 'General',
    aliasKey: 'TelegramGeneralSettingsViewController',
    icon: 'settings-filled',
    iconBg: 'orange',
  },
  {
    screen: SettingsScreens.Notifications,
    parent: SettingsScreens.Main,
    titleKey: 'Notifications',
    keywordsKey: 'SettingsKeywordsNotifications',
    icon: 'notifications-filled',
    iconBg: 'red',
  },
  {
    screen: SettingsScreens.Privacy,
    parent: SettingsScreens.Main,
    titleKey: 'PrivacySettings',
    icon: 'lock-filled',
    iconBg: 'gray',
  },
  {
    screen: SettingsScreens.DataStorage,
    parent: SettingsScreens.Main,
    titleKey: 'DataSettings',
    keywordsKey: 'SettingsKeywordsDataStorage',
    icon: 'piechart-filled',
    iconBg: 'green',
  },
  {
    screen: SettingsScreens.Folders,
    parent: SettingsScreens.Main,
    titleKey: 'Filters',
    keywordsKey: 'SettingsKeywordsFolders',
    icon: 'folder-filled',
    iconBg: 'blue',
  },
  {
    screen: SettingsScreens.Backups,
    parent: SettingsScreens.Main,
    titleKey: 'SettingsBackups',
    keywordsKey: 'SettingsKeywordsBackups',
    icon: 'archive-filled',
    iconBg: 'orange',
    requires: 'hasBackups',
  },
  {
    screen: SettingsScreens.SignalDevices,
    parent: SettingsScreens.Main,
    titleKey: 'SignalDevices',
    keywordsKey: 'SettingsKeywordsSignalDevices',
    icon: 'devices-filled',
    iconBg: 'blue',
  },
  {
    screen: SettingsScreens.Performance,
    parent: SettingsScreens.Main,
    titleKey: 'MenuAnimations',
    keywordsKey: 'SettingsKeywordsPerformance',
    icon: 'animations-filled',
    iconBg: 'purple',
  },
  {
    screen: SettingsScreens.Stickers,
    parent: SettingsScreens.Main,
    titleKey: 'MenuStickers',
    keywordsKey: 'SettingsKeywordsStickers',
    icon: 'smile-filled',
    iconBg: 'pink',
  },
  {
    screen: SettingsScreens.Language,
    parent: SettingsScreens.Main,
    titleKey: 'Language',
    keywordsKey: 'SettingsKeywordsLanguage',
    icon: 'web-filled',
    iconBg: 'purple',
  },
  {
    screen: SettingsScreens.KeyboardShortcuts,
    parent: SettingsScreens.Main,
    titleKey: 'KeyboardShortcuts',
    keywordsKey: 'SettingsKeywordsShortcuts',
    icon: 'keyboard-filled',
    iconBg: 'gray',
    requires: 'canSendWithKeyboard',
  },

  {
    screen: SettingsScreens.GeneralChatBackground,
    parent: SettingsScreens.General,
    titleKey: 'ChatBackground',
    keywordsKey: 'SettingsKeywordsChatBackground',
  },
  {
    screen: SettingsScreens.GeneralChatBackgroundColor,
    parent: SettingsScreens.GeneralChatBackground,
    titleKey: 'SetColor',
  },
  {
    screen: SettingsScreens.Username,
    parent: SettingsScreens.EditProfile,
    titleKey: 'Username',
    keywordsKey: 'SettingsKeywordsUsername',
  },
  {
    screen: SettingsScreens.NotificationProfiles,
    parent: SettingsScreens.Notifications,
    titleKey: 'NotificationProfiles',
    keywordsKey: 'SettingsKeywordsNotificationProfiles',
  },
  {
    screen: SettingsScreens.SignalProxy,
    parent: SettingsScreens.DataStorage,
    titleKey: 'SignalProxyTitle',
    keywordsKey: 'SettingsKeywordsSignalProxy',
  },
  {
    screen: SettingsScreens.SignalSealedSenderProxy,
    parent: SettingsScreens.DataStorage,
    titleKey: 'SignalSealedProxyTitle',
    keywordsKey: 'SettingsKeywordsSealedProxy',
  },
  {
    screen: SettingsScreens.CustomEmoji,
    parent: SettingsScreens.Stickers,
    titleKey: 'Emoji',
    aliasKey: 'StickersListEmojiItem',
  },

  {
    screen: SettingsScreens.PrivacyBlockedUsers,
    parent: SettingsScreens.Privacy,
    titleKey: 'BlockedUsers',
    keywordsKey: 'SettingsKeywordsBlockedUsers',
  },
  {
    screen: SettingsScreens.Stories,
    parent: SettingsScreens.Privacy,
    titleKey: 'StoriesSettingTitle',
    keywordsKey: 'SettingsKeywordsStories',
  },
  {
    screen: SettingsScreens.PasscodeDisabled,
    parent: SettingsScreens.Privacy,
    titleKey: 'Passcode',
    keywordsKey: 'SettingsKeywordsPasscode',
    requires: 'canSetPasscode',
    screenWhen: { flag: 'hasPasscode', screen: SettingsScreens.PasscodeEnabled },
  },
  {
    screen: SettingsScreens.SignalPin,
    parent: SettingsScreens.Privacy,
    titleKey: 'SignalPinSettings',
    keywordsKey: 'SettingsKeywordsSignalPin',
    requires: 'hasSignalPinSettings',
  },
  {
    screen: SettingsScreens.AutoDeleteMessages,
    parent: SettingsScreens.Privacy,
    titleKey: 'AutoDeleteMessages',
    keywordsKey: 'SettingsKeywordsAutoDelete',
    requires: 'canSetAutoDelete',
  },
  {
    screen: SettingsScreens.PrivacyPhoneNumber,
    parent: SettingsScreens.Privacy,
    titleKey: 'PrivacyPhone',
  },
  {
    screen: SettingsScreens.PrivacyLastSeen,
    parent: SettingsScreens.Privacy,
    titleKey: 'PrivacyLastSeen',
    keywordsKey: 'SettingsKeywordsLastSeen',
  },
  {
    screen: SettingsScreens.PrivacyProfilePhoto,
    parent: SettingsScreens.Privacy,
    titleKey: 'PrivacyProfilePhoto',
  },
  {
    screen: SettingsScreens.PrivacyBio,
    parent: SettingsScreens.Privacy,
    titleKey: 'PrivacyBio',
  },
  {
    screen: SettingsScreens.PrivacyBirthday,
    parent: SettingsScreens.Privacy,
    titleKey: 'PrivacyBirthday',
  },
  {
    screen: SettingsScreens.PrivacySavedMusic,
    parent: SettingsScreens.Privacy,
    titleKey: 'PrivacyMusic',
  },
  {
    screen: SettingsScreens.PrivacyForwarding,
    parent: SettingsScreens.Privacy,
    titleKey: 'PrivacyForwards',
  },
  {
    screen: SettingsScreens.PrivacyPhoneCall,
    parent: SettingsScreens.Privacy,
    titleKey: 'Calls',
  },
  {
    screen: SettingsScreens.PrivacyVoiceMessages,
    parent: SettingsScreens.Privacy,
    titleKey: 'PrivacyVoiceMessages',
  },
  {
    screen: SettingsScreens.PrivacyGroupChats,
    parent: SettingsScreens.Privacy,
    titleKey: 'AutodownloadGroupChats',
  },
];

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  ...buildEntries(SettingsScreens.Main, ['MenuSignalSupport'], { icon: 'help-filled', iconBg: 'blue' }),
  ...buildEntries(SettingsScreens.Main, ['MenuPrivacyPolicy'], { icon: 'privacy-policy-filled', iconBg: 'green' }),
  ...buildEntries(SettingsScreens.Main, ['LogOutTitle'], {
    keywordsKey: 'SettingsKeywordsLogOut', icon: 'logout', iconBg: 'gray',
  }),

  ...buildEntries(SettingsScreens.EditProfile, ['FirstName', 'LastName', 'SignalProfileAbout']),
  ...buildEntries(SettingsScreens.Username, ['SignalUsernameLink', 'SignalUsernameLinkReset', 'SignalUsernameDelete']),

  ...buildEntries(SettingsScreens.KeyboardShortcuts, [
    'SettingsSendEnter', IS_MAC_OS || IS_IOS ? 'SettingsSendCmdenter' : 'SettingsSendCtrlenter',
  ], { requires: 'canSendWithKeyboard' }),
  ...buildEntries(
    SettingsScreens.KeyboardShortcuts,
    unique(KEYBOARD_SHORTCUT_IDS.filter(getIsKeyboardShortcutAvailable).map((id) => KEYBOARD_SHORTCUTS[id].titleKey)),
    { requires: 'canSendWithKeyboard' },
  ),

  ...buildEntries(SettingsScreens.General, ['TextSize'], { keywordsKey: 'SettingsKeywordsTextSize' }),
  ...buildEntries(SettingsScreens.General, ['ColorTheme'], { keywordsKey: 'SettingsKeywordsTheme' }),
  ...buildEntries(SettingsScreens.General, ['SettingsTimeFormat'], { keywordsKey: 'SettingsKeywordsTimeFormat' }),
  ...buildEntries(SettingsScreens.General, [
    'EmptyChatAppearanceLight', 'EmptyChatAppearanceDark', 'EmptyChatAppearanceSystem', 'SettingsTimeFormat12',
    'SettingsTimeFormat24', 'SettingsAutomaticTextReplacements', 'SettingsKeyboard',
  ]),
  ...buildEntries(SettingsScreens.General, IS_TAURI ? ['SettingsDesktopTray', 'SettingsDesktopAutostart'] : []),
  ...buildEntries(SettingsScreens.General, IS_TAURI && CAN_PROTECT_CONTENT ? ['SettingsDesktopProtect'] : []),

  ...buildEntries(SettingsScreens.GeneralChatBackground, [
    'UploadImage', 'ThemeResetToDefaults', 'BackgroundPatternIntensity', 'BackgroundBlurred',
    'ChatBackgroundColorThemes',
  ]),

  ...buildEntries(SettingsScreens.Notifications, [
    'NotificationsWeb', 'NotificationsForPrivateChats', 'MessagePreview',
    'NotificationsForGroups', 'ContactJoined', 'PinnedMessagesNotifications',
  ]),
  ...buildEntries(SettingsScreens.Notifications, IS_IOS ? [] : ['NotificationsSound']),
  ...buildEntries(SettingsScreens.Notifications, ['PushPreviewsWhenLocked'], { requires: 'hasPasscode' }),
  ...buildEntries(SettingsScreens.Notifications, ['AutodownloadPrivateChats'], {
    keywordsKey: 'SettingsKeywordsPrivateChats',
  }),
  ...buildEntries(SettingsScreens.Notifications, ['FilterGroups'], { keywordsKey: 'SettingsKeywordsGroups' }),

  ...buildEntries(SettingsScreens.DataStorage, [
    'AutoDownloadPhotosTitle', 'AutoDownloadVideosTitle', 'AutoDownloadFilesTitle', 'AutoDownloadSettingsContacts',
    'AutoDownloadSettingsPrivateChats', 'AutoDownloadSettingsGroupChats',
    'AutoDownloadMaxFileSize', 'SettingsDataClearMediaCache',
  ]),
  ...buildEntries(SettingsScreens.DataStorage, IS_TAURI ? ['SettingsAskWhereToSave'] : []),

  ...buildEntries(SettingsScreens.Performance, [
    'SettingsPerformanceSliderTitle', 'SettingsPerformanceGranularTitle', 'SettingsPerformanceInterfaceAnimations',
    'SettingsPerformanceStickers', 'SettingsPerformanceMediaAutoplay', 'SettingsPerformancePageTransitions',
    'SettingsPerformanceSending', 'SettingsPerformanceMediaViewer', 'SettingsPerformanceComposer',
    'SettingsPerformanceContextAnimation', 'SettingsPerformanceContextBlur', 'SettingsPerformanceRightColumn',
    'SettingsPerformanceTextStreaming', 'SettingsPerformanceAnimatedEmoji', 'SettingsPerformanceLoopStickers',
    'SettingsPerformanceReactionEffects', 'SettingsPerformanceStickerEffects', 'SettingsPerformanceAutoplayGif',
    'SettingsPerformanceAutoplayVideo',
  ]),

  ...buildEntries(SettingsScreens.Stickers, ['SuggestStickers', 'InstalledStickersDynamicPackOrder']),
  ...buildEntries(SettingsScreens.Stickers, ['ChooseStickerMyStickerSets'], { requires: 'areStickerSetsLoaded' }),
  ...buildEntries(SettingsScreens.CustomEmoji, ['SuggestAnimatedEmoji'], { requires: 'areCustomEmojiSetsLoaded' }),

  ...buildEntries(SettingsScreens.Language, ['LocalizationInterfaceLanguage']),

  ...buildEntries(SettingsScreens.Folders, ['TabsPosition', 'TabsPositionLeft', 'TabsPositionTop'], {
    requires: 'isDesktopLayout',
  }),

  ...buildEntries(SettingsScreens.Privacy, [
    'PrivacyTitle', 'SettingsWindowSystem', 'SettingsTitleChatName', 'DeleteMyAccount', 'DeleteAccountIfAwayFor',
  ]),
  ...buildEntries(SettingsScreens.Privacy, ['SettingsSensitiveTitle', 'SettingsSensitiveDisableFiltering'], {
    requires: 'canChangeSensitive',
  }),
  ...buildEntries(SettingsScreens.Privacy, ['SignalContactDiscovery'], { requires: 'hasSignalPinSettings' }),
  ...buildEntries(SettingsScreens.Privacy, ['NewChatsFromNonContacts'], {
    requires: 'canDisplayAutoarchiveSetting',
  }),
  ...buildEntries(SettingsScreens.Privacy, ['ArchiveAndMute'], {
    requires: 'canDisplayAutoarchiveSetting', keywordsKey: 'SettingsKeywordsArchiveAndMute',
  }),
  ...buildEntries(SettingsScreens.Privacy, ['SignalReadReceipts'], { keywordsKey: 'SettingsKeywordsReadReceipts' }),
  ...buildEntries(SettingsScreens.Privacy, ['SignalTypingIndicators'], {
    keywordsKey: 'SettingsKeywordsTypingIndicators',
  }),
  ...buildEntries(SettingsScreens.Privacy, ['SignalSealedSenderIndicators'], {
    keywordsKey: 'SettingsKeywordsSealedSender',
  }),
  ...buildEntries(SettingsScreens.Privacy, ['SignalLinkPreviews'], { keywordsKey: 'SettingsKeywordsLinkPreviews' }),
  ...buildEntries(SettingsScreens.Privacy, ['RecoveryKey']),
  ...buildEntries(SettingsScreens.NotificationProfiles, ['NotificationProfileNew']),
  ...buildEntries(SettingsScreens.Privacy, ['KeyTransTitle'], {
    requires: 'hasKeyTransparency', keywordsKey: 'SettingsKeywordsKeyTrans',
  }),
  ...buildEntries(SettingsScreens.Stories, [
    'StoriesSettingEnable', 'StoriesSettingViewReceipts', 'StoryRibbonMyStory', 'StoriesSettingAllowReplies',
    'StoriesSettingCustomLists', 'StoriesSettingNewList',
  ]),

  ...PRIVACY_VISIBILITY_SCREENS.flatMap(([screen, titleKey]) => [
    ...buildEntries(screen, [titleKey], { isSectionHeader: true }),
    ...buildEntries(screen, ['P2PEverybody', 'P2PContacts', 'P2PNobody']),
  ]),
  ...buildEntries(SettingsScreens.PrivacyPhoneNumber, ['PrivacyPhoneTitle', 'PrivacyPhoneTitle2'], {
    isSectionHeader: true,
  }),
  ...buildEntries(SettingsScreens.PrivacyPhoneNumber, ['P2PEverybody', 'P2PNobody']),
  ...buildEntries(SettingsScreens.PrivacyLastSeen, ['HideReadTime'], { requires: 'canHideReadTime' }),
  ...buildEntries(SettingsScreens.PrivacyPhoneCall, ['PrivacyP2P']),

  ...buildEntries(SettingsScreens.AutoDeleteMessages, [
    'SetAutoDeleteTimer', 'SettingsItemPrivacyOff', 'SetCustomTime',
  ]),

  ...buildEntries(SettingsScreens.PasscodeEnabled, [
    'PasscodeChange', 'PasscodeTurnOff', 'PasscodeLockScreenTitle', 'PasscodeKeepBackground', 'PasscodeAutoLockTitle',
    'PasscodeAutoLockDisabled', 'PasscodeAutoLock1Min', 'PasscodeAutoLock5Min', 'PasscodeAutoLock30Min',
    'PasscodeAutoLock1Hour',
  ], { requires: 'hasPasscode' }),
  ...buildEntries(SettingsScreens.PasscodeEnabled, ['PasscodePasskeyTitle'], { requires: 'canUnlockWithPasskey' }),
];

function buildEntries(
  screen: SettingsScreens, titleKeys: RegularLangKey[], options?: EntryOptions,
): SettingsSearchEntry[] {
  return titleKeys.map((titleKey) => ({ screen, titleKey, ...options }));
}
