import type { ApiChat } from './chats';
import type { ApiUser } from './users';

export type ApiPrivacyKey = 'phoneNumber' | 'addByPhone' | 'lastSeen' | 'profilePhoto' | 'voiceMessages' |
  'forwards' | 'chatInvite' | 'phoneCall' | 'phoneP2P' | 'bio' | 'birthday' |
  'savedMusic';
export type PrivacyVisibility = 'everybody' | 'contacts' | 'closeFriends' | 'nonContacts' | 'nobody';
/** The Signal PIN of a primary device and the Registration Lock that needs it */
export type ApiSignalPinSettings = {
  hasPin: boolean;
  isRegistrationLockEnabled: boolean;
};

/**
 * The state of an automatic key verification (key transparency) of a chat: `idle` before it runs, `fail` when the log
 * does not list the keys, `error` when the check could not finish and may be repeated, `unavailable` for a chat that
 * cannot be checked
 */
export type ApiKeyTransparencyStatus = 'idle' | 'running' | 'ok' | 'fail' | 'error' | 'unavailable';

/** The state of the check of our own account; `intermittent` is a first failure, which the check repeats a day later */
export type ApiKeyTransparencySelfStatus = 'idle' | 'running' | 'ok' | 'fail' | 'intermittent';

/** The message settings of the account, which the storage service keeps for all its devices */
export type ApiSignalMessageSettings = {
  isReadReceiptsEnabled: boolean;
  isTypingIndicatorsEnabled: boolean;
  isLinkPreviewsEnabled: boolean;
  isSealedSenderIndicatorsEnabled: boolean;
};

/** A device of the account; `lastSeen` is in milliseconds, with the precision of a day */
export type ApiSignalDevice = {
  id: number;
  name?: string;
  lastSeen: number;
};

/** The devices of the account: a primary device links and unlinks them, a linked device only lists them */
export type ApiSignalDevices = {
  isPrimary: boolean;
  currentDeviceId: number;
  devices: ApiSignalDevice[];
};

export interface ApiPrivacySettings {
  visibility: PrivacyVisibility;
  isUnspecified?: boolean;
  allowUserIds: string[];
  allowChatIds: string[];
  blockUserIds: string[];
  blockChatIds: string[];
}

export interface ApiInputPrivacyRules {
  visibility: PrivacyVisibility;
  isUnspecified?: boolean;
  allowedUsers?: ApiUser[];
  allowedChats?: ApiChat[];
  blockedUsers?: ApiUser[];
  blockedChats?: ApiChat[];
}

export interface ApiLanguage {
  isOfficial?: true;
  isRtl?: true;
  isBeta?: true;
  name: string;
  nativeName: string;
  langCode: string;
  baseLangCode?: string;
  pluralCode: string;
  stringsCount: number;
  translatedCount: number;
  translationsUrl?: string;
}

export type LangPack = {
  langCode: string;
  version: number;
  strings: Record<string, LangPackStringValue>;
};

export type CachedLangData = {
  langPack: LangPack;
  baseLangPack?: LangPack;
  language: ApiLanguage;
};

export type LangPackStringValueRegular = string;
export type LangPackStringValueDeleted = {
  isDeleted: true;
};
export type LangPackStringValuePlural = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type LangPackStringValue = LangPackStringValueRegular | LangPackStringValueDeleted | LangPackStringValuePlural;

export type ApiBackupFrequency = 'daily' | 'weekly' | 'monthly' | 'manual';

/** The progress of a backup that is running: an export and its validation, then the upload */
export type ApiBackupProgress = {
  step: 'exporting' | 'validating' | 'uploading';
  // From 0 to 1, while uploading
  progress?: number;
};

/** Signal Secure Backups of this account: the settings and the state of the last backup */
export type ApiBackupSettings = {
  // The account lacks what a backup needs: its recovery key, or the root key of the media backup
  unavailableReason?: 'noRecoveryKey' | 'noMediaRootKey';
  isPrimary: boolean;
  isEnabled: boolean;
  frequency: ApiBackupFrequency;
  // Milliseconds since the epoch
  lastBackupAt?: number;
  lastBackupSize?: number;
  // The level of the backup credential: 200 is the free tier, 201 the paid one
  tier?: number;
  lastError?: string;
  isRunning?: boolean;
  progress?: ApiBackupProgress;
};

/** What the backup service holds for the account, read when the screen opens */
export type ApiBackupRemoteStatus = {
  hasBackup: boolean;
  size?: number;
  // Milliseconds since the epoch
  modifiedAt?: number;
  tier?: number;
};
