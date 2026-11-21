import type { ResolvedPos } from '@tiptap/pm/model';
import { PluginKey } from '@tiptap/pm/state';

import type {
  RichEditorTooltipSuggestion,
  RichEditorTooltipSurface,
} from '../../types';
import type { RichEditorTooltipsController } from './controller';

export const TOOLTIP_GAP_PX = 12;
export const SEARCH_DEBOUNCE_MS = 300;

export const PLUGIN_KEYS = {
  emoji: new PluginKey('richEditorEmojiSuggestion'),
  customEmoji: new PluginKey('richEditorCustomEmojiSuggestion'),
  mention: new PluginKey('richEditorMentionSuggestion'),
  sticker: new PluginKey('richEditorStickerSuggestion'),
};

export type GetTooltipController = () => RichEditorTooltipsController | undefined;

export function buildSuggestionRenderer(
  surface: RichEditorTooltipSurface,
  getController: GetTooltipController,
) {
  return {
    onStart: (props: RichEditorTooltipSuggestion) => getController()?.updateSuggestion(surface, props),
    onUpdate: (props: RichEditorTooltipSuggestion) => getController()?.updateSuggestion(surface, props),
    onExit: () => getController()?.removeSuggestion(surface),
    onKeyDown: ({ event }: { event: KeyboardEvent }) => (
      getController()?.handleSuggestionKeyDown(surface, event) || false
    ),
  };
}

export function hasUnsuitableContext($position: ResolvedPos) {
  for (let depth = $position.depth; depth > 0; depth--) {
    const node = $position.node(depth);
    if (isUnsuitableNode(node.type.name) || node.type.spec.code) {
      return true;
    }
  }

  return false;
}

export function isUnsuitableNode(typeName: string) {
  return typeName === 'codeBlock'
    || typeName === 'mathBlock'
    || typeName === 'mathInline'
    || typeName === 'mention'
    || typeName === 'customEmoji';
}

export function buildBlockMatch($position: ResolvedPos, text: string, query: string) {
  return {
    range: { from: $position.pos - text.length, to: $position.pos },
    query,
    text,
  };
}
