import type { Range as TiptapRange } from '@tiptap/core';
import type { SuggestionProps } from '@tiptap/suggestion';

import type { ApiChatMember, ApiSticker, ApiUser } from '../../../api/types';
import type { GlobalActions } from '../../../global';
import type { ThreadId } from '../../../types';
import type { RichEditorTooltipsController } from './extensions/richEditorTooltips/controller';

export type RichEditorTooltipsStorage = {
  config?: RichEditorTooltipsConfig;
  controller?: RichEditorTooltipsController;
};

export type RichEditorTooltipContext = {
  chatId: string;
  threadId?: ThreadId;
  currentUserId?: string;
  currentUser?: ApiUser;
  groupChatMembers?: ApiChatMember[];
  recentEmojiIds?: string[];
  baseEmojiKeywords?: Record<string, string[]>;
  emojiKeywords?: Record<string, string[]>;
  isSavedMessages?: boolean;
  isInScheduledList?: boolean;
  canSendGifs?: boolean;
  isRichInputExpanded?: boolean;
  isFormatterDisabled?: boolean;
  isFormatterContextMenuOpen?: boolean;
};

export type RichEditorTooltipSurface = 'emoji' | 'customEmoji' | 'mention' | 'sticker';
export type RichEditorTooltipItem = Emoji | ApiSticker | ApiUser;

export type RichEditorTooltipSuggestion = SuggestionProps<RichEditorTooltipItem, RichEditorTooltipItem>;

export type RichEditorFormatterControl = 'date' | 'link';

export type RichEditorFormatterState = {
  range: TiptapRange;
  capabilities: 'basic' | 'full';
  controlRequest?: {
    control: RichEditorFormatterControl;
  };
};

type RichEditorTooltipSurfaceConfig = {
  isEnabled: () => boolean;
};

type RichEditorFormatterConfig = {
  isEnabled: () => boolean;
  capabilities: 'basic' | 'full';
};

type RichEditorEmojiTooltipConfig = RichEditorTooltipSurfaceConfig & {
  addRecentEmoji: GlobalActions['addRecentEmoji'];
  addRecentCustomEmoji: GlobalActions['addRecentCustomEmoji'];
};

type RichEditorCustomEmojiTooltipConfig = RichEditorTooltipSurfaceConfig & {
  addRecentCustomEmoji: GlobalActions['addRecentCustomEmoji'];
};

type RichEditorStickerTooltipConfig = RichEditorTooltipSurfaceConfig & {
  onSelect: (sticker: ApiSticker, isSilent?: boolean, shouldSchedule?: boolean) => void;
};

export type RichEditorTooltipsConfig = {
  emoji?: RichEditorEmojiTooltipConfig;
  customEmoji?: RichEditorCustomEmojiTooltipConfig;
  mention?: RichEditorTooltipSurfaceConfig;
  sticker?: RichEditorStickerTooltipConfig;
  formatter?: RichEditorFormatterConfig;
  getTooltipBoundary?: () => HTMLElement | undefined;
  getContext: () => RichEditorTooltipContext;
};
