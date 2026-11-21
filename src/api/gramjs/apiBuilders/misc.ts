import { Api as GramJs } from '../../../lib/gramjs';

import type {
  ApiBaseTheme,
  ApiChatTheme,
  ApiConfig,
  ApiCountry,
  ApiLanguage,
  ApiPeerTheme,
  ApiPendingSuggestion,
  ApiPrivacyKey,
  ApiPromoData,
  ApiRestrictionReason,
  ApiShareTheme,
  ApiShareThemeBackdrop,
  ApiThemeSettings,
  ApiWallpaper,
  ApiWallpaperSettings,
  LangPackStringValue,
} from '../../types';

import int2hex from '../../../util/int2hex';
import { omitUndefined } from '../../../util/iteratees';
import { addDocumentToLocalDb } from '../helpers/localDb';
import { buildApiFormattedText } from './common';
import { buildApiDocument } from './messageContent';
import { buildApiReaction } from './reactions';

const PATTERN_MIME_TYPE = 'application/x-tgwallpattern';

export function buildApiWallpaper(wallpaper: GramJs.TypeWallPaper): ApiWallpaper | undefined {
  if (wallpaper instanceof GramJs.WallPaperNoFile) {
    const settings = wallpaper.settings && buildApiWallpaperSettings(wallpaper.settings);
    if (!settings) {
      return undefined;
    }

    return {
      slug: String(wallpaper.id),
      isDark: wallpaper.dark,
      isDefault: wallpaper.default,
      settings,
    };
  }

  const { slug } = wallpaper;

  addDocumentToLocalDb(wallpaper.document);

  const document = buildApiDocument(wallpaper.document);

  if (!document) {
    return undefined;
  }

  return {
    slug,
    document,
    // The server can omit the `pattern` flag while retaining the pattern MIME type
    isPattern: wallpaper.pattern || document.mimeType === PATTERN_MIME_TYPE || undefined,
    isDark: wallpaper.dark,
    isCreator: wallpaper.creator,
    isDefault: wallpaper.default,
    settings: wallpaper.settings && buildApiWallpaperSettings(wallpaper.settings),
  };
}

function buildApiWallpaperSettings(settings: GramJs.TypeWallPaperSettings): ApiWallpaperSettings {
  const {
    backgroundColor, secondBackgroundColor, thirdBackgroundColor, fourthBackgroundColor,
    intensity, rotation, blur, motion, emoticon,
  } = settings;

  return {
    backgroundColor,
    secondBackgroundColor,
    thirdBackgroundColor,
    fourthBackgroundColor,
    intensity,
    rotation,
    emoticon,
    isBlurred: blur,
    isMoving: motion,
  };
}

const BASE_THEME_BY_CLASS_NAME: Record<string, ApiBaseTheme> = {
  BaseThemeClassic: 'classic',
  BaseThemeDay: 'day',
  BaseThemeNight: 'night',
  BaseThemeTinted: 'tinted',
  BaseThemeArctic: 'day',
};

export function buildApiChatTheme(theme: GramJs.Theme): ApiChatTheme | undefined {
  if (!theme.emoticon || !theme.settings?.length) {
    return undefined;
  }

  const settings = theme.settings
    .map(buildApiThemeSettings)
    .filter(Boolean);

  if (!settings.length) {
    return undefined;
  }

  return {
    emoticon: theme.emoticon,
    isDefault: theme.default,
    settings,
  };
}

export function buildApiPeerTheme(theme: GramJs.TypeChatTheme): ApiPeerTheme | undefined {
  if (!(theme instanceof GramJs.ChatTheme) || !theme.emoticon) return undefined;

  return { type: 'emoticon', emoticon: theme.emoticon };
}

function buildApiThemeSettings(settings: GramJs.TypeThemeSettings): ApiThemeSettings | undefined {
  if (!(settings instanceof GramJs.ThemeSettings)) {
    return undefined;
  }

  const baseTheme = BASE_THEME_BY_CLASS_NAME[settings.baseTheme.className];
  if (!baseTheme) {
    return undefined;
  }

  return {
    baseTheme,
    accentColor: int2hex(settings.accentColor),
    outgoingColors: settings.messageColors?.map(int2hex),
    areOutgoingColorsAnimated: settings.messageColorsAnimated,
    outboxAccentColor: settings.outboxAccentColor !== undefined ? int2hex(settings.outboxAccentColor) : undefined,
    wallpaper: settings.wallpaper && buildApiWallpaper(settings.wallpaper),
  };
}

export function buildPrivacyKey(key: GramJs.TypePrivacyKey): ApiPrivacyKey | undefined {
  switch (key.className) {
    case 'PrivacyKeyPhoneNumber':
      return 'phoneNumber';
    case 'PrivacyKeyAddedByPhone':
      return 'addByPhone';
    case 'PrivacyKeyStatusTimestamp':
      return 'lastSeen';
    case 'PrivacyKeyProfilePhoto':
      return 'profilePhoto';
    case 'PrivacyKeyPhoneCall':
      return 'phoneCall';
    case 'PrivacyKeyPhoneP2P':
      return 'phoneP2P';
    case 'PrivacyKeyForwards':
      return 'forwards';
    case 'PrivacyKeyVoiceMessages':
      return 'voiceMessages';
    case 'PrivacyKeyChatInvite':
      return 'chatInvite';
    case 'PrivacyKeyAbout':
      return 'bio';
    case 'PrivacyKeyBirthday':
      return 'birthday';
    case 'PrivacyKeySavedMusic':
      return 'savedMusic';
  }

  return undefined;
}

function buildApiCountry(country: GramJs.help.Country, code: GramJs.help.CountryCode) {
  const {
    hidden, iso2, defaultName, name,
  } = country;
  const { countryCode, prefixes, patterns } = code || {};

  return {
    isHidden: hidden,
    iso2,
    defaultName,
    name,
    countryCode,
    prefixes,
    patterns,
  };
}

export function buildApiCountryList(countries: GramJs.help.Country[]) {
  const nonHiddenCountries = countries.filter(({ hidden }) => !hidden);
  const listByCode = nonHiddenCountries
    .map((country) => (
      country.countryCodes.map((code) => buildApiCountry(country, code))
    ))
    .flat()
    .sort((a: ApiCountry, b: ApiCountry) => (
      a.name ? a.name.localeCompare(b.name!) : a.defaultName.localeCompare(b.defaultName)
    ));

  const generalList = nonHiddenCountries
    .map((country) => buildApiCountry(country, country.countryCodes[0]))
    .sort((a, b) => (
      a.name ? a.name.localeCompare(b.name!) : a.defaultName.localeCompare(b.defaultName)
    ));

  return {
    phoneCodes: listByCode,
    general: generalList,
  };
}

export function buildJson(json: GramJs.TypeJSONValue): any {
  if (json instanceof GramJs.JsonNull) return undefined;
  if (json instanceof GramJs.JsonString
    || json instanceof GramJs.JsonBool
    || json instanceof GramJs.JsonNumber) return json.value;
  if (json instanceof GramJs.JsonArray) return json.value.map(buildJson);

  return json.value.reduce((acc: Record<string, any>, el) => {
    acc[el.key] = buildJson(el.value);
    return acc;
  }, {});
}

export function buildApiConfig(config: GramJs.Config): ApiConfig {
  const {
    testMode, expires, gifSearchUsername, chatSizeMax, autologinToken, reactionsDefault,
    messageLengthMax, editTimeLimit, forwardedCountMax, ratingEDecay,
  } = config;
  const defaultReaction = reactionsDefault && buildApiReaction(reactionsDefault);
  return {
    isTestServer: testMode,
    expiresAt: expires,
    gifSearchUsername,
    defaultReaction,
    maxGroupSize: chatSizeMax,
    autologinToken,
    maxMessageLength: messageLengthMax,
    editTimeLimit,
    maxForwardedCount: forwardedCountMax,
    ratingEDecay,
  };
}

export function buildApiPromoData(promoData: GramJs.help.PromoData): ApiPromoData {
  const {
    expires, pendingSuggestions, dismissedSuggestions, customPendingSuggestion,
  } = promoData;
  return {
    expires,
    pendingSuggestions,
    dismissedSuggestions,
    customPendingSuggestion: customPendingSuggestion ? buildApiPendingSuggestion(customPendingSuggestion) : undefined,
  };
}

function buildApiPendingSuggestion(pendingSuggestion: GramJs.TypePendingSuggestion): ApiPendingSuggestion {
  const {
    suggestion, title, description, url,
  } = pendingSuggestion;
  return {
    suggestion,
    title: buildApiFormattedText(title),
    description: buildApiFormattedText(description),
    url,
  };
}

export function buildLangStrings(strings: GramJs.TypeLangPackString[]) {
  const keysToRemove: string[] = [];
  const apiStrings = strings.reduce<Record<string, LangPackStringValue>>((acc, mtpString) => {
    if (mtpString instanceof GramJs.LangPackStringDeleted) {
      keysToRemove.push(mtpString.key);
    }

    if (mtpString instanceof GramJs.LangPackString) {
      acc[mtpString.key] = mtpString.value;
    }

    if (mtpString instanceof GramJs.LangPackStringPluralized) {
      acc[mtpString.key] = omitUndefined({
        zero: mtpString.zeroValue,
        one: mtpString.oneValue,
        two: mtpString.twoValue,
        few: mtpString.fewValue,
        many: mtpString.manyValue,
        other: mtpString.otherValue,
      });
    }

    return acc;
  }, {});

  return {
    keysToRemove,
    strings: apiStrings,
  };
}

export function buildApiLanguage(lang: GramJs.TypeLangPackLanguage): ApiLanguage {
  const {
    name, nativeName, langCode, baseLangCode, pluralCode, rtl, stringsCount, translatedCount,
    translationsUrl, beta, official,
  } = lang;
  return {
    name,
    nativeName,
    langCode,
    baseLangCode,
    pluralCode,
    isRtl: rtl,
    isBeta: beta,
    isOfficial: official,
    stringsCount,
    translatedCount,
    translationsUrl,
  };
}

export function buildApiRestrictionReasons(
  restrictionReasons?: GramJs.RestrictionReason[],
): ApiRestrictionReason[] | undefined {
  if (!restrictionReasons) {
    return undefined;
  }

  return restrictionReasons.map((
    { reason, text, platform }) =>
    ({ reason, text, platform }));
}

export function buildApiShareTheme(shareTheme: GramJs.TypeShareTheme): ApiShareTheme | undefined {
  if (!(shareTheme instanceof GramJs.ShareThemeEmojiBackdrop)) return undefined;

  return {
    type: 'emojiBackdrop',
    backdropId: shareTheme.backdropId,
    emojis: shareTheme.emojis?.map((reaction) => buildApiReaction(reaction)).filter(Boolean) || [],
  };
}

export function buildApiShareThemeBackdrop(backdrop: GramJs.ShareThemeBackdropOption): ApiShareThemeBackdrop {
  const {
    backdropId, name, centerColor, edgeColor, patternColor, textColor,
  } = backdrop;

  return {
    backdropId,
    name,
    centerColor: int2hex(centerColor),
    edgeColor: int2hex(edgeColor),
    patternColor: int2hex(patternColor),
    textColor: int2hex(textColor),
  };
}
