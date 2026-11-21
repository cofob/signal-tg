import type { MemberLabel } from './buildGroupChange';
import type { GroupMember } from './fetchGroup';

const EMOJI_PATTERN = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]️?⃣)/u;

/** The label of a member as one text, the emoji first, which is how clients show it */
export function formatMemberLabel({ labelEmoji, label }: Pick<GroupMember, 'labelEmoji' | 'label'>) {
  if (!label) return undefined;
  return labelEmoji ? `${labelEmoji} ${label}` : label;
}

/**
 * The inverse of `formatMemberLabel`: a leading emoji becomes the emoji of the label, as Signal Android and
 * Desktop keep it apart from the text; text that is only an emoji stays the text
 */
export function parseMemberLabel(value: string): MemberLabel {
  const text = value.trim();
  const [first] = new Intl.Segmenter().segment(text);
  const emoji = first?.segment;
  if (emoji && EMOJI_PATTERN.test(emoji)) {
    const rest = text.slice(emoji.length).trim();
    if (rest) return { emoji, text: rest };
  }
  return { text };
}
