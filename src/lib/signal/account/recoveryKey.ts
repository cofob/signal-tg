// Signal Android `AccountEntropyPool.CHARACTER_DISPLAY_MAP`: the letter O and the digit 0 look alike in some fonts
const DISPLAY_CHARACTERS: Record<string, string> = { O: '#', 0: '=' };
const AMBIGUOUS_CHARACTERS = /[O0]/g;
const WHITESPACE_AND_DASHES = /[\s-]/g;

/** The account entropy pool as Signal shows it to users, who call it the recovery key (`displayValue` on Android) */
export function formatRecoveryKey(accountEntropyPool: string) {
  return accountEntropyPool.toUpperCase().replace(AMBIGUOUS_CHARACTERS, (character) => DISPLAY_CHARACTERS[character]);
}

/** What a user typed or pasted for a recovery key: without spaces and dashes, and with the display characters undone */
export function normalizeRecoveryKey(input: string) {
  return input.replace(WHITESPACE_AND_DASHES, '').toLowerCase().replace(/#/g, 'o').replace(/=/g, '0');
}
