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
