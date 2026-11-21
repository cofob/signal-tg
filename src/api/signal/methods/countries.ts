import { COUNTRY_CALLING_CODES } from '../countryCallingCodes';

const DEFAULT_LANG_CODE = 'en';

/** The countries of phone number entry, named in the app language by the browser (`Intl.DisplayNames`) */
export function fetchCountryList({ langCode = DEFAULT_LANG_CODE }: { langCode?: string }) {
  const defaultNames = new Intl.DisplayNames([DEFAULT_LANG_CODE], { type: 'region' });
  const names = new Intl.DisplayNames([langCode, DEFAULT_LANG_CODE], { type: 'region' });

  const phoneCodes = COUNTRY_CALLING_CODES
    .map(([iso2, countryCode, prefixes]) => ({
      isHidden: undefined,
      iso2,
      countryCode,
      prefixes,
      patterns: undefined,
      defaultName: defaultNames.of(iso2) ?? iso2,
      name: names.of(iso2),
    }))
    .sort((a, b) => (a.name ?? a.defaultName).localeCompare(b.name ?? b.defaultName, langCode));

  // Each country has one calling code, so the general list is the same
  return Promise.resolve({ phoneCodes, general: phoneCodes });
}

/** Signal has no location lookup; the browser language's likely region preselects the country */
export function fetchNearestCountry() {
  return Promise.resolve(new Intl.Locale(navigator.language).maximize().region);
}
