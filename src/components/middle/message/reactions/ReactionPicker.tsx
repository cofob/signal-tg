import { memo, useMemo, useRef } from '../../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../../global';

import type {
  ApiMessage,
  ApiMessageEntity,
  ApiReaction,
  ApiSticker,
  ApiStory,
  ApiStorySkipped,
} from '../../../../api/types';
import type { IAnchorPosition } from '../../../../types';

import { getReactionKey, getStoryKey } from '../../../../global/helpers';
import {
  selectChat,
  selectChatFullInfo,
  selectChatMessage,
  selectIsContextMenuTranslucent,
  selectIsCurrentUserPremium,
  selectPeerStory,
  selectTabState,
} from '../../../../global/selectors';
import { IS_TUCK_SUPPORTED } from '../../../../util/browser/windowEnvironment';
import buildClassName from '../../../../util/buildClassName';
import { isUserId } from '../../../../util/entities/ids';
import parseHtmlAsFormattedText from '../../../../util/text/parseHtmlAsFormattedText';
import { REM } from '../../../common/helpers/mediaDimensions';
import { buildCustomEmojiHtml } from '../../composer/helpers/customEmoji';

import { getIsMobile } from '../../../../hooks/useAppLayout';
import useCurrentOrPrev from '../../../../hooks/useCurrentOrPrev';
import useLastCallback from '../../../../hooks/useLastCallback';
import useTuckFilter from '../../../../hooks/useTuckFilter';

import CustomEmojiPicker from '../../../common/CustomEmojiPicker';
import Menu from '../../../ui/Menu';
import EmojiPicker from '../../composer/EmojiPicker';
import ReactionPickerLimited from './ReactionPickerLimited';

import styles from './ReactionPicker.module.scss';

export type OwnProps = {
  isOpen: boolean;
};

interface StateProps {
  shouldUseFullPicker?: boolean;
  message?: ApiMessage;
  story?: ApiStory | ApiStorySkipped;
  isCurrentUserPremium?: boolean;
  position?: IAnchorPosition;
  isTranslucent?: boolean;
  sendAsMessage?: boolean;
  hasReactionCatalog?: boolean;
}

const FULL_PICKER_SHIFT_DELTA = { x: -23, y: -64 };
const LIMITED_PICKER_SHIFT_DELTA = { x: -21, y: -10 };
const REACTION_SELECTOR_WIDTH = 16.375 * REM;
const FILTER_ID = 'reaction-picker-tuck-filter';

const ReactionPicker = ({
  isOpen,
  message,
  story,
  position,
  isTranslucent,
  isCurrentUserPremium,
  shouldUseFullPicker,
  sendAsMessage,
  hasReactionCatalog,
}: OwnProps & StateProps) => {
  const {
    toggleReaction, closeReactionPicker, sendMessage, showNotification, sendStoryReaction,
  } = getActions();

  const renderedMessageId = useCurrentOrPrev(message?.id, true);
  const renderedChatId = useCurrentOrPrev(message?.chatId, true);
  const renderedStoryPeerId = useCurrentOrPrev(story?.peerId, true);
  const renderedStoryId = useCurrentOrPrev(story?.id);
  const storedPosition = useCurrentOrPrev(position, true);
  const menuRef = useRef<HTMLDivElement>();
  const pickerListStyle = useTuckFilter(FILTER_ID);
  const renderingPosition = useMemo((): IAnchorPosition | undefined => {
    if (!storedPosition) {
      return undefined;
    }

    if (renderedStoryId) {
      return storedPosition;
    }

    return {
      x: storedPosition.x + (shouldUseFullPicker ? FULL_PICKER_SHIFT_DELTA.x : LIMITED_PICKER_SHIFT_DELTA.x),
      y: storedPosition.y + (shouldUseFullPicker ? FULL_PICKER_SHIFT_DELTA.y : LIMITED_PICKER_SHIFT_DELTA.y),
    };
  }, [renderedStoryId, storedPosition, shouldUseFullPicker]);

  const getMenuElement = useLastCallback(() => menuRef.current);
  const getLayout = useLastCallback(() => ({
    withPortal: true,
    isDense: !renderedStoryPeerId,
    deltaX: !getIsMobile() && menuRef.current
      ? -(menuRef.current.offsetWidth - REACTION_SELECTOR_WIDTH) / 2 - FULL_PICKER_SHIFT_DELTA.x / 2
      : 0,
  }));

  const handleToggleCustomReaction = useLastCallback((sticker: ApiSticker) => {
    if (!renderedChatId || !renderedMessageId) {
      return;
    }
    const reaction: ApiReaction = sticker.isCustomEmoji
      ? { type: 'custom', documentId: sticker.id }
      : { type: 'emoji', emoticon: sticker.emoji! };

    toggleReaction({
      chatId: renderedChatId, messageId: renderedMessageId, reaction, shouldAddToRecent: true,
    });
    closeReactionPicker();
  });

  const handleEmojiSelect = useLastCallback((emoticon: string) => {
    handleToggleReaction({ type: 'emoji', emoticon });
  });

  const handleToggleReaction = useLastCallback((reaction: ApiReaction) => {
    if (!renderedChatId || !renderedMessageId) {
      return;
    }

    toggleReaction({
      chatId: renderedChatId, messageId: renderedMessageId, reaction, shouldAddToRecent: true,
    });
    closeReactionPicker();
  });

  const handleStoryReactionSelect = useLastCallback((item: ApiReaction | ApiSticker) => {
    const reaction = 'id' in item ? { type: 'custom', documentId: item.id } as const : item;

    const sticker = 'type' in item && item.type === 'custom' ? getGlobal().customEmojis.byId[item.documentId]
      : 'id' in item ? item : undefined;

    if (sticker && !sticker.isFree && !isCurrentUserPremium) {
      showNotification({
        message: {
          key: 'UnlockPremiumEmojiHint',
          options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
        },
      });

      closeReactionPicker();

      return;
    }

    if (!sendAsMessage) {
      sendStoryReaction({
        peerId: renderedStoryPeerId!,
        storyId: renderedStoryId!,
        containerId: getStoryKey(renderedStoryPeerId!, renderedStoryId!),
        reaction,
        shouldAddToRecent: true,
      });
      closeReactionPicker();
      return;
    }

    let text: string | undefined;
    let entities: ApiMessageEntity[] | undefined;

    if ('type' in item && item.type === 'emoji') {
      text = item.emoticon;
    } else {
      const customEmojiMessage = parseHtmlAsFormattedText(buildCustomEmojiHtml(sticker!));
      text = customEmojiMessage.text;
      entities = customEmojiMessage.entities;
    }

    sendMessage({ text, entities, isReaction: true });
    closeReactionPicker();
  });

  const selectedReactionIds = useMemo(() => {
    return (message?.reactions?.results || []).reduce<string[]>((acc, { chosenOrder, reaction }) => {
      if (chosenOrder !== undefined) {
        acc.push(getReactionKey(reaction));
      }

      return acc;
    }, []);
  }, [message?.reactions?.results]);

  const shouldUseTuck = IS_TUCK_SUPPORTED && Boolean(shouldUseFullPicker || renderedStoryId);

  return (
    <Menu
      isOpen={isOpen}
      ref={menuRef}
      className={buildClassName(styles.menu, 'ReactionPicker')}
      bubbleClassName={buildClassName(
        styles.menuContent,
        !shouldUseFullPicker && !renderedStoryId && styles.onlyReactions,
        renderedStoryId && styles.storyMenu,
      )}
      withPortal
      noCompact
      anchor={renderingPosition}
      positionY={story && 'bottom'}
      getTriggerElement={getTriggerElement}
      getRootElement={getRootElement}
      getMenuElement={getMenuElement}
      getLayout={getLayout}
      backdropExcludedSelector=".Modal.confirm"
      onClose={closeReactionPicker}
    >
      {!hasReactionCatalog && !renderedStoryId ? (
        <EmojiPicker
          chatId={renderedChatId}
          idPrefix="message-reaction-emoji-"
          isHidden={!isOpen}
          loadAndPlay={isOpen}
          isTranslucent={isTranslucent}
          onEmojiSelect={handleEmojiSelect}
          onCustomEmojiSelect={handleToggleCustomReaction}
        />
      ) : (
        <>
          <CustomEmojiPicker
            chatId={renderedChatId}
            idPrefix="message-emoji-set-"
            isHidden={!isOpen || !(shouldUseFullPicker || renderedStoryId)}
            loadAndPlay={Boolean(isOpen && shouldUseFullPicker)}
            isReactionPicker
            isTuckEnabled={shouldUseTuck}
            className={buildClassName(
              !shouldUseFullPicker && !renderedStoryId && styles.hidden,
              shouldUseTuck && styles.extendedPicker,
            )}
            pickerListStyle={shouldUseTuck ? pickerListStyle : undefined}
            selectedReactionIds={selectedReactionIds}
            isTranslucent={isTranslucent}
            onCustomEmojiSelect={renderedStoryId ? handleStoryReactionSelect : handleToggleCustomReaction}
            onReactionSelect={renderedStoryId ? handleStoryReactionSelect : handleToggleReaction}
          />
          {!shouldUseFullPicker && Boolean(renderedChatId) && (
            <ReactionPickerLimited
              chatId={renderedChatId}
              loadAndPlay={isOpen}
              onReactionSelect={renderedStoryId ? handleStoryReactionSelect : handleToggleReaction}
              selectedReactionIds={selectedReactionIds}
              message={message}
            />
          )}
        </>
      )}
    </Menu>
  );
};

export default memo(withGlobal<OwnProps>((global): Complete<StateProps> => {
  const state = selectTabState(global);
  const {
    chatId, messageId, storyPeerId, storyId, position, sendAsMessage,
  } = state.reactionPicker || {};
  const story = storyPeerId && storyId
    ? selectPeerStory(global, storyPeerId, storyId) as ApiStory | ApiStorySkipped
    : undefined;
  const chat = chatId ? selectChat(global, chatId) : undefined;
  const chatFullInfo = chatId ? selectChatFullInfo(global, chatId) : undefined;
  const message = chatId && messageId ? selectChatMessage(global, chatId, messageId) : undefined;
  const isPrivateChat = isUserId(chatId || storyPeerId || '');
  const areSomeReactionsAllowed = chatFullInfo?.enabledReactions?.type === 'some';
  const { maxUniqueReactions } = global.appConfig;
  const areAllReactionsAllowed = chatFullInfo?.enabledReactions?.type === 'all'
    && chatFullInfo?.enabledReactions?.areCustomAllowed;

  // Signal has no reaction catalog: any emoji is a reaction, so the picker shows the full emoji set
  const hasReactionCatalog = Boolean(global.reactions.availableReactions?.length);
  const currentReactions = message?.reactions?.results;
  const shouldUseCurrentReactions = Boolean(maxUniqueReactions && currentReactions
    && currentReactions.length >= maxUniqueReactions);

  return {
    message,
    story,
    position,
    shouldUseFullPicker: (chat?.isForbidden || areSomeReactionsAllowed || shouldUseCurrentReactions) ? false
      : (areAllReactionsAllowed || isPrivateChat || !hasReactionCatalog),
    isTranslucent: selectIsContextMenuTranslucent(global),
    isCurrentUserPremium: selectIsCurrentUserPremium(global),
    sendAsMessage,
    hasReactionCatalog,
  };
})(ReactionPicker));

function getTriggerElement(): HTMLElement | null {
  return document.querySelector('body');
}

function getRootElement() {
  return document.querySelector('body');
}
