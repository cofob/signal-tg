import type { RegularLangKey } from '../types/language';

import useLang from './useLang';

// Strings come from the app's built-in languages, and only the active one is loaded
export default function useLangString(key: RegularLangKey, langCode?: string) {
  const lang = useLang();

  return langCode === lang.rawCode ? lang(key) : undefined;
}
