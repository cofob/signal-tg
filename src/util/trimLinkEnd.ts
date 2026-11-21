const TRAILING_PUNCTUATION = '.,;:!?';
const OPENING_BRACKET = '(';
const CLOSING_BRACKET = ')';

/**
 * Cuts the punctuation that ends the sentence around a link, and the closing brackets that have no opening bracket
 * in the link. One scan from the end, so a link of any length takes linear time.
 */
export function trimLinkEnd(link: string) {
  let unopenedBracketCount = 0;
  for (const char of link) {
    if (char === OPENING_BRACKET) unopenedBracketCount--;
    else if (char === CLOSING_BRACKET) unopenedBracketCount++;
  }

  let end = link.length;
  while (end > 0) {
    const char = link[end - 1];
    if (TRAILING_PUNCTUATION.includes(char)) {
      end--;
    } else if (char === CLOSING_BRACKET && unopenedBracketCount > 0) {
      unopenedBracketCount--;
      end--;
    } else {
      break;
    }
  }
  return link.slice(0, end);
}
