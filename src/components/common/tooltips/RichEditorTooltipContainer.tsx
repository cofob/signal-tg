import type { Editor } from '@tiptap/core';
import { memo } from '../../../lib/teact/teact';
import { withGlobal } from '../../../global';

import type { ApiSticker, ApiUser } from '../../../api/types';
import type {
  RichEditorFormatterState,
  RichEditorTooltipContext,
  RichEditorTooltipItem,
  RichEditorTooltipsConfig,
  RichEditorTooltipSuggestion,
  RichEditorTooltipSurface,
} from './types';

import buildClassName from '../../../util/buildClassName';

import useLastCallback from '../../../hooks/useLastCallback';

import TextFormatter from '../../ui/textInput/TextFormatter';
import CustomEmojiTooltip from './CustomEmojiTooltip.async';
import EmojiTooltip from './EmojiTooltip.async';
import MentionTooltip from './MentionTooltip.async';
import RichEditorTooltipPanel from './RichEditorTooltipPanel';
import StickerTooltip from './StickerTooltip.async';

import styles from './RichEditorTooltipContainer.module.scss';

export type OwnProps = {
  editor: Editor;
  surface?: RichEditorTooltipSurface;
  suggestion?: RichEditorTooltipSuggestion;
  customEmojiSuggestion?: RichEditorTooltipSuggestion;
  stickerSuggestion?: RichEditorTooltipSuggestion;
  formatter?: RichEditorFormatterState;
  isOpen: boolean;
  isCustomEmojiOpen: boolean;
  isStickerOpen: boolean;
  isFormatterOpen: boolean;
  selectedIndex: number;
  config: RichEditorTooltipsConfig;
  context: RichEditorTooltipContext;
  onCloseFormatter: NoneToVoidFunction;
  onFormatterDismissalChange: (isBlocked: boolean) => void;
};

type StateProps = {
  customEmoji?: ApiSticker[];
  stickers?: ApiSticker[];
};

const RichEditorTooltipContainer = ({
  editor,
  surface,
  suggestion,
  customEmojiSuggestion,
  stickerSuggestion,
  formatter,
  isOpen,
  isCustomEmojiOpen,
  isStickerOpen,
  isFormatterOpen,
  selectedIndex,
  config,
  context,
  customEmoji,
  stickers,
  onCloseFormatter,
  onFormatterDismissalChange,
}: OwnProps & StateProps) => {
  const handleMentionSelect = useLastCallback((user: ApiUser) => suggestion?.command(user));
  const handleEmojiSelect = useLastCallback((emoji: string) => {
    const item = suggestion ? findEmojiItem(suggestion.items, emoji) : undefined;
    if (item) {
      suggestion!.command(item);
    }
  });
  const handleCustomEmojiSelect = useLastCallback((emoji: ApiSticker) => suggestion?.command(emoji));
  const handleStickerSelect = useLastCallback((
    sticker: ApiSticker,
    isSilent?: boolean,
    shouldSchedule?: boolean,
  ) => config.sticker?.onSelect(sticker, isSilent, shouldSchedule));
  const handleStackCustomEmojiSelect = useLastCallback((emoji: ApiSticker) => customEmojiSuggestion?.command(emoji));
  if (formatter && !editor.isDestroyed) {
    return (
      <div className={styles.formatter}>
        <RichEditorTooltipPanel isOpen={isFormatterOpen}>
          <TextFormatter
            editor={editor}
            range={formatter.range}
            capabilities={formatter.capabilities}
            controlRequest={formatter.controlRequest}
            isRichInputExpanded={context.isRichInputExpanded}
            onClose={onCloseFormatter}
            onDismissalChange={onFormatterDismissalChange}
          />
        </RichEditorTooltipPanel>
      </div>
    );
  }

  if (!surface || !suggestion) {
    return undefined;
  }

  if (surface === 'mention') {
    return (
      <div className={buildClassName(styles.root, styles.compact)}>
        <MentionTooltip
          isOpen={isOpen}
          selectedIndex={selectedIndex}
          filteredUsers={suggestion.items as ApiUser[]}
          onInsertUserName={handleMentionSelect}
        />
      </div>
    );
  }

  if (surface === 'emoji') {
    if (!config.emoji) {
      return undefined;
    }

    const emojis = suggestion.items.filter((item): item is Emoji => 'native' in item);
    const customEmojis = suggestion.items.filter((item): item is ApiSticker => !('native' in item));

    return (
      <div className={styles.root}>
        <EmojiTooltip
          isOpen={isOpen}
          selectedIndex={selectedIndex}
          emojis={emojis}
          customEmojis={customEmojis}
          onEmojiSelect={handleEmojiSelect}
          onCustomEmojiSelect={handleCustomEmojiSelect}
        />
      </div>
    );
  }

  if (surface === 'customEmoji' || surface === 'sticker') {
    const customEmojiConfig = config.customEmoji;
    return (
      <div className={buildClassName(styles.emojiStack, stickerSuggestion && styles.raised)}>
        {stickerSuggestion ? (
          <StickerTooltip
            isOpen={isStickerOpen}
            chatId={context.chatId}
            threadId={context.threadId}
            stickers={stickers}
            isSavedMessages={context.isSavedMessages}
            onStickerSelect={handleStickerSelect}
          />
        ) : undefined}
        {customEmojiSuggestion && customEmojiConfig ? (
          <CustomEmojiTooltip
            isOpen={isCustomEmojiOpen}
            customEmoji={customEmoji}
            isSavedMessages={context.isSavedMessages}
            addRecentCustomEmoji={customEmojiConfig.addRecentCustomEmoji}
            onCustomEmojiSelect={handleStackCustomEmojiSelect}
          />
        ) : undefined}
      </div>
    );
  }

  return undefined;
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => ({
    customEmoji: global.customEmojis.forEmoji.stickers,
    stickers: global.stickers.forEmoji.stickers,
  }),
)(RichEditorTooltipContainer));

function findEmojiItem(items: RichEditorTooltipItem[], native: string) {
  return items.find((item): item is Emoji => 'native' in item && item.native === native);
}
