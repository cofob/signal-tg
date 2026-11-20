import type { MessageInitShape } from '@bufbuild/protobuf';

import type { BodyRange, BodyRangeSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import type { ApiFormattedText, ApiMessageEntity, ApiMessageEntityDefault } from '../../types';
import { ApiMessageEntityTypes } from '../../types';

import { BodyRange_Style } from '../../../lib/signal/proto/generated/SignalService_pb';
import { uuidToString } from '../../../lib/signal/serviceId';

type Replacement = { start: number; length: number; text: string };

export type MentionedUser = { userId: string; name: string };

// A mention takes one object replacement character in the body (Signal Desktop `ts/types/BodyRange.std.ts`)
const MENTION_PLACEHOLDER = '￼';

const ENTITY_TYPE_BY_STYLE: Partial<Record<BodyRange_Style, ApiMessageEntityDefault['type']>> = {
  [BodyRange_Style.BOLD]: ApiMessageEntityTypes.Bold,
  [BodyRange_Style.ITALIC]: ApiMessageEntityTypes.Italic,
  [BodyRange_Style.SPOILER]: ApiMessageEntityTypes.Spoiler,
  [BodyRange_Style.STRIKETHROUGH]: ApiMessageEntityTypes.Strike,
  [BodyRange_Style.MONOSPACE]: ApiMessageEntityTypes.Code,
};

// Signal has no underline, links with text, quotes or custom emoji, so their entities keep only the text
const STYLE_BY_ENTITY_TYPE: Partial<Record<ApiMessageEntity['type'], BodyRange_Style>> = {
  [ApiMessageEntityTypes.Bold]: BodyRange_Style.BOLD,
  [ApiMessageEntityTypes.Italic]: BodyRange_Style.ITALIC,
  [ApiMessageEntityTypes.Spoiler]: BodyRange_Style.SPOILER,
  [ApiMessageEntityTypes.Strike]: BodyRange_Style.STRIKETHROUGH,
  [ApiMessageEntityTypes.Code]: BodyRange_Style.MONOSPACE,
  [ApiMessageEntityTypes.Pre]: BodyRange_Style.MONOSPACE,
};

export function getMentionAci(range: BodyRange) {
  const { associatedValue } = range;
  if (associatedValue.case === 'mentionAci') return associatedValue.value;
  if (associatedValue.case === 'mentionAciBinary') return uuidToString(associatedValue.value);
  return undefined;
}

/**
 * Text and entities of a Signal body. Offsets of both are UTF-16 code units. Styles become formatting entities,
 * and each mention placeholder becomes `@Name` with a mention entity of its user.
 */
export function buildApiFormattedText(
  body: string, bodyRanges: BodyRange[], mentionedUsers: Map<string, MentionedUser>,
): ApiFormattedText {
  const replacements: (Replacement & { userId: string })[] = [];
  for (const range of bodyRanges) {
    const aci = getMentionAci(range);
    const user = aci ? mentionedUsers.get(aci) : undefined;
    if (!user) continue;
    replacements.push({
      start: range.start, length: range.length, text: `@${user.name}`, userId: user.userId,
    });
  }

  const { text, mentions, mapOffset } = replaceRanges(body, replacements);
  const entities: ApiMessageEntity[] = [];
  for (const range of bodyRanges) {
    const type = range.associatedValue.case === 'style' ? ENTITY_TYPE_BY_STYLE[range.associatedValue.value] : undefined;
    if (!type) continue;
    const offset = mapOffset(range.start, false);
    const length = mapOffset(range.start + range.length, true) - offset;
    if (length > 0) entities.push({ type, offset, length });
  }
  for (const mention of mentions) {
    entities.push({
      type: ApiMessageEntityTypes.MentionName,
      offset: mapOffset(mention.start, false),
      length: mention.text.length,
      userId: mention.userId,
    });
  }

  return { text, entities: entities.length ? entities.sort((a, b) => a.offset - b.offset) : undefined };
}

/**
 * The body and body ranges of a composed text. `getEntityAci` resolves mention entities to ACIs; each one
 * becomes a placeholder character in the body.
 */
export function buildBodyRanges(
  { text, entities = [] }: ApiFormattedText, getEntityAci: (entity: ApiMessageEntity) => string | undefined,
) {
  const replacements: (Replacement & { aci: string })[] = [];
  for (const entity of entities) {
    const aci = getEntityAci(entity);
    if (aci) replacements.push({ start: entity.offset, length: entity.length, text: MENTION_PLACEHOLDER, aci });
  }

  const { text: body, mentions, mapOffset } = replaceRanges(text, replacements);
  const bodyRanges: MessageInitShape<typeof BodyRangeSchema>[] = [];
  for (const entity of entities) {
    const style = STYLE_BY_ENTITY_TYPE[entity.type];
    if (style === undefined) continue;
    const start = mapOffset(entity.offset, false);
    const length = mapOffset(entity.offset + entity.length, true) - start;
    if (length > 0) bodyRanges.push({ start, length, associatedValue: { case: 'style', value: style } });
  }
  for (const mention of mentions) {
    bodyRanges.push({
      start: mapOffset(mention.start, false),
      length: MENTION_PLACEHOLDER.length,
      associatedValue: { case: 'mentionAci', value: mention.aci },
    });
  }

  return { body, bodyRanges };
}

/**
 * Replaces ranges of `text`, skipping ones that overlap an earlier replacement, and returns the applied
 * ones as `mentions` with how offsets of the original text move. A range that covers part of a replacement
 * grows to cover all of it.
 */
function replaceRanges<T extends Replacement>(text: string, replacements: T[]) {
  const applied: T[] = [];
  let result = '';
  let cursor = 0;
  for (const replacement of [...replacements].sort((a, b) => a.start - b.start)) {
    if (replacement.start < cursor) continue;
    result += text.slice(cursor, replacement.start) + replacement.text;
    cursor = replacement.start + replacement.length;
    applied.push(replacement);
  }
  result += text.slice(cursor);

  function mapOffset(offset: number, isEnd: boolean) {
    let shift = 0;
    for (const { start, length, text: replacementText } of applied) {
      if (offset <= start) break;
      if (offset < start + length) return start + shift + (isEnd ? replacementText.length : 0);
      shift += replacementText.length - length;
    }
    return offset + shift;
  }

  return { text: result, mentions: applied, mapOffset };
}
