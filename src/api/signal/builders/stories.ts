import { fromBinary } from '@bufbuild/protobuf';

import type { ConversationRecord, StoryRecord } from '../../../lib/signal/db/MessageDb';
import type { TextAttachment } from '../../../lib/signal/proto/generated/SignalService_pb';
import type { StoryDistributionList } from '../../../lib/signal/store/SignalStore';
import type {
  ApiStory,
  ApiStoryDistributionList,
  ApiStoryViews,
  ApiTextStory,
  ApiTextStoryStyle,
  ApiTypeStoryView,
  MediaContent,
} from '../../types';
import type { UserResolver } from './messages';

import { StoryMessageSchema, TextAttachment_Style } from '../../../lib/signal/proto/generated/SignalService_pb';
import { MY_STORY_ID } from '../../../lib/signal/stories/storyLists';
import { getStoryBackgroundCss, getStoryColorCss, STORY_COLOR_WHITE } from '../../../util/storyBackgrounds';
import { getPeerId } from '../peers';
import { buildApiFormattedText } from './bodyRanges';
import { buildStoryMedia } from './media';
import { resolveMentionedUsers } from './messages';

const MS_PER_SECOND = 1000;
const RECENT_VIEWERS_COUNT = 3;
const TEXT_STYLES: Record<TextAttachment_Style, ApiTextStoryStyle> = {
  [TextAttachment_Style.DEFAULT]: 'default',
  [TextAttachment_Style.REGULAR]: 'regular',
  [TextAttachment_Style.BOLD]: 'bold',
  [TextAttachment_Style.SERIF]: 'serif',
  [TextAttachment_Style.SCRIPT]: 'script',
  [TextAttachment_Style.CONDENSED]: 'condensed',
};

/**
 * Builds the app story of a stored Signal story. A story belongs to its author, or to its group, whose stories name
 * their author. Media stories show their photo or video with the caption; text stories show `textStory`.
 */
export async function buildApiStory(
  story: StoryRecord, conversation: ConversationRecord, selfAci: string, users: UserResolver,
): Promise<ApiStory> {
  const { attachment, bodyRanges, allowsReplies } = fromBinary(StoryMessageSchema, story.storyMessage);
  const isGroup = conversation.type === 'group';
  let content: MediaContent = {};
  if (attachment.case === 'fileAttachment') {
    const pointer = attachment.value;
    content = buildStoryMedia(story.id, story.sentAt, pointer);
    if (pointer.caption) {
      content.text = buildApiFormattedText(pointer.caption, bodyRanges, await resolveMentionedUsers(bodyRanges, users));
    }
  }
  const ownReaction = story.replies?.findLast(({ authorAci, emoji }) => authorAci === selfAci && emoji)?.emoji;

  return {
    '@type': 'story',
    id: story.id,
    peerId: getPeerId(conversation),
    date: convertToSeconds(story.sentAt),
    expireDate: convertToSeconds(story.expiresAt),
    content,
    textStory: attachment.case === 'textAttachment' ? buildTextStory(attachment.value) : undefined,
    isOut: story.isOutgoing || undefined,
    fromId: isGroup ? await users.getUserId(story.authorAci) : undefined,
    // Signal stories cannot be forwarded from here, and replies to group stories are always allowed
    noForwards: true,
    noReplies: !allowsReplies && !isGroup ? true : undefined,
    sentReaction: ownReaction ? { type: 'emoji', emoticon: ownReaction } : undefined,
    views: story.isOutgoing ? await buildStoryViews(story, users) : undefined,
  };
}

/** Viewers of our story from viewed receipts, and the replies and reactions it got */
export async function buildStoryViews(story: StoryRecord, users: UserResolver): Promise<ApiStoryViews> {
  const viewers = Object.entries(story.recipients ?? {})
    .filter(([, { viewedAt }]) => viewedAt)
    .sort(([, a], [, b]) => b.viewedAt! - a.viewedAt!);
  const replies = story.replies?.filter(({ authorAci }) => authorAci !== story.authorAci) ?? [];
  return {
    hasViewers: viewers.length ? true : undefined,
    viewsCount: viewers.length,
    reactionsCount: replies.filter(({ emoji }) => emoji).length,
    repliesCount: replies.filter(({ body }) => body).length,
    recentViewerIds: await Promise.all(viewers.slice(0, RECENT_VIEWERS_COUNT).map(([aci]) => users.getUserId(aci))),
  };
}

/** Who viewed our story, with their reactions, and the replies; newest first */
export async function buildStoryViewList(story: StoryRecord, users: UserResolver): Promise<ApiTypeStoryView[]> {
  const replies = story.replies?.filter(({ authorAci }) => authorAci !== story.authorAci) ?? [];
  const views: ApiTypeStoryView[] = [];
  for (const [aci, { viewedAt }] of Object.entries(story.recipients ?? {})) {
    if (!viewedAt) continue;
    const emoji = replies.findLast((reply) => reply.authorAci === aci && reply.emoji)?.emoji;
    views.push({
      type: 'user',
      peerId: await users.getUserId(aci),
      date: convertToSeconds(viewedAt),
      reaction: emoji ? { type: 'emoji', emoticon: emoji } : undefined,
    });
  }
  for (const { authorAci, sentAt, body, emoji } of replies) {
    views.push({
      type: 'reply',
      peerId: await users.getUserId(authorAci),
      date: convertToSeconds(sentAt),
      text: body ? { text: body } : undefined,
      reaction: emoji ? { type: 'emoji', emoticon: emoji } : undefined,
    });
  }
  return views.sort((a, b) => b.date - a.date);
}

export async function buildApiStoryDistributionList(
  list: StoryDistributionList, getUserId: (aci: string) => Promise<string>,
): Promise<ApiStoryDistributionList> {
  return {
    id: list.id,
    name: list.name,
    memberIds: await Promise.all(list.memberAcis.map(getUserId)),
    areRepliesAllowed: list.areRepliesAllowed,
    isBlockList: list.isBlockList,
    isMyStory: list.id === MY_STORY_ID || undefined,
  };
}

/** Signal Desktop `TextAttachment.dom.tsx`: white text on the background, one of five fonts */
function buildTextStory(attachment: TextAttachment): ApiTextStory {
  const { background, preview } = attachment;
  let backgroundCss = getStoryColorCss(STORY_COLOR_WHITE);
  if (background.case === 'color') {
    backgroundCss = getStoryBackgroundCss({ color: background.value });
  } else if (background.case === 'gradient') {
    const { angle, colors, positions, startColor, endColor } = background.value;
    // Older clients send the start and end colors only
    backgroundCss = colors.length && colors.length === positions.length
      ? getStoryBackgroundCss({ angle, colors, positions })
      : getStoryBackgroundCss({ angle, colors: [startColor, endColor], positions: [0, 1] });
  }

  return {
    text: attachment.text || undefined,
    style: TEXT_STYLES[attachment.textStyle] ?? 'default',
    textColor: getStoryColorCss(attachment.textForegroundColor || STORY_COLOR_WHITE),
    textBackgroundColor: attachment.textBackgroundColor ? getStoryColorCss(attachment.textBackgroundColor) : undefined,
    background: backgroundCss,
    linkPreview: preview?.url
      ? { url: preview.url, title: preview.title || undefined, description: preview.description || undefined }
      : undefined,
  };
}

function convertToSeconds(timestamp: number) {
  return Math.floor(timestamp / MS_PER_SECOND);
}
