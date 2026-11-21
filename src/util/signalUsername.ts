// A nickname is 3 to 32 characters (`MIN_NICKNAME_LENGTH` and `MAX_NICKNAME_LENGTH` of the engine) and cannot start
// with a digit; the discriminator has at least 2 digits. The engine's `libsignal` check is the final word.
const USERNAME_SEARCH_PATTERN = /^@?([a-z_][a-z\d_]{2,31}\.\d{2,})$/i;

/**
 * The Signal username that a search text looks like (`alice.42` or `@alice.42`), without the `@`, or `undefined`.
 * Like `getUsernameFromSearch` of Signal Desktop, which `LeftPaneComposeHelper`
 * (`ts/components/leftPane/LeftPaneComposeHelper.tsx`) uses to offer a lookup. Only the shape is checked: whether the
 * username exists is for the server to say.
 */
export function parseUsernameSearch(text: string) {
  return text.trim().match(USERNAME_SEARCH_PATTERN)?.[1];
}
