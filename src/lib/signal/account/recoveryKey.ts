// Signal Android `AccountEntropyPool.CHARACTER_DISPLAY_MAP`: the letter O and the digit 0 look alike in some fonts
const DISPLAY_CHARACTERS: Record<string, string> = { O: '#', 0: '=' };
const AMBIGUOUS_CHARACTERS = /[O0]/g;

/** The account entropy pool as Signal shows it to users, who call it the recovery key (`displayValue` on Android) */
export function formatRecoveryKey(accountEntropyPool: string) {
  return accountEntropyPool.toUpperCase().replace(AMBIGUOUS_CHARACTERS, (character) => DISPLAY_CHARACTERS[character]);
}
