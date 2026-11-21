import type { MessageInitShape } from '@bufbuild/protobuf';

import type { BodyRange, BodyRangeSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import type { ApiFormattedText, ApiMessageEntity, ApiMessageEntityDefault } from '../../types';
import { ApiMessageEntityTypes } from '../../types';

import { RE_LINK_TEMPLATE } from '../../../config';
import { BodyRange_Style } from '../../../lib/signal/proto/generated/SignalService_pb';
import { uuidToString } from '../../../lib/signal/serviceId';
import { getSgnlLinkStart, isSignalRoute } from '../../../util/signalLinks';
import { trimLinkEnd } from '../../../util/trimLinkEnd';

type Replacement = { start: number; length: number; text: string };

export type MentionedUser = { userId: string; name: string };

// A mention takes one object replacement character in the body (Signal Desktop `ts/types/BodyRange.std.ts`)
const MENTION_PLACEHOLDER = '￼';

// Text that links are not made of: a spoiler hides its link until it is revealed, so the link stays plain
const NO_LINK_ENTITY_TYPES = new Set<ApiMessageEntity['type']>([
  ApiMessageEntityTypes.Code,
  ApiMessageEntityTypes.Pre,
  ApiMessageEntityTypes.MentionName,
  ApiMessageEntityTypes.Spoiler,
]);
const RE_LINK = new RegExp(RE_LINK_TEMPLATE, 'gi');
// Links with a scheme or `www.`, and Signal's links, which have no `www.`; plain `name.ext` is no link
const RE_EXPLICIT_LINK = /^(?:(?:https?|ftp):\/\/|www\.)/i;
const RE_ADDRESS_WITH_USER = /^[^/?#]*@/;
// Signal Desktop `shouldLinkifyMessage`: a text that changes its direction has no links
const RE_DIRECTIONAL_OVERRIDE = /[\u202c-\u202e]/;
// Bounds on the work that a text can cause: the pattern of links takes time in proportion to the text, and each link
// becomes an element
const MAX_LINKIFIED_TEXT_LENGTH = 2 ** 16;
const MAX_LINK_LENGTH = 4096;
const MAX_LINKS = 100;

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

  entities.push(...buildLinkEntities(text, entities));

  // An entity that contains another starts first, as the nesting of the rendered text needs
  entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return { text, entities: entities.length ? entities : undefined };
}

/**
 * Entities of the links in a text, which Signal does not send: apps find them in the text. A link is none inside
 * code, a mention or a spoiler, or when it overlaps a style without one containing the other, which the rendered
 * text could not nest.
 */
function buildLinkEntities(text: string, entities: ApiMessageEntity[]): ApiMessageEntity[] {
  if (text.length > MAX_LINKIFIED_TEXT_LENGTH || RE_DIRECTIONAL_OVERRIDE.test(text)) return [];

  const links: ApiMessageEntity[] = [];
  for (const { 0: match, index: offset } of text.matchAll(RE_LINK)) {
    if (links.length >= MAX_LINKS) break;
    // The checks that take no time in proportion to the match come before the trim
    if (match.length > MAX_LINK_LENGTH || RE_ADDRESS_WITH_USER.test(match)) continue;

    const link = trimLinkEnd(match);
    if (!RE_EXPLICIT_LINK.test(link) && !isSignalRoute(link)) continue;

    const start = getSgnlLinkStart(text, offset, link);
    const end = offset + link.length;
    if (getCanLink(start, end, entities)) {
      links.push({ type: ApiMessageEntityTypes.Url, offset: start, length: end - start });
    }
  }
  return links;
}

function getCanLink(start: number, end: number, entities: ApiMessageEntity[]) {
  return entities.every((entity) => {
    const entityEnd = entity.offset + entity.length;
    if (entity.offset >= end || entityEnd <= start) return true;
    if (NO_LINK_ENTITY_TYPES.has(entity.type)) return false;

    const isInside = entity.offset <= start && end <= entityEnd;
    const isAround = start <= entity.offset && entityEnd <= end;
    return isInside || isAround;
  });
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
