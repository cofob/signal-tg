import { memo, useMemo, useRef } from '../../../../lib/teact/teact';

import type {
  ApiAvailableReaction,
  ApiChatReactions,
  ApiReaction,
  ApiReactionCount,
  ApiReactionCustomEmoji,
  ApiReactionEmoji,
} from '../../../../api/types';
import type { IAnchorPosition } from '../../../../types';

import {
  canSendReaction, getReactionKey, isSameReaction, sortReactions,
} from '../../../../global/helpers';
import buildClassName, { createClassNameBuilder } from '../../../../util/buildClassName';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Button from '../../../ui/Button';
import ReactionSelectorCustomReaction from './ReactionSelectorCustomReaction';
import ReactionSelectorReaction from './ReactionSelectorReaction';

import './ReactionSelector.scss';

type RenderableReactions = (ApiAvailableReaction | ApiReactionCustomEmoji | ApiReactionEmoji)[];

type OwnProps = {
  enabledReactions?: ApiChatReactions;
  isPrivate?: boolean;
  topReactions?: ApiReaction[];
  defaultTagReactions?: ApiReaction[];
  allAvailableReactions?: ApiAvailableReaction[];
  currentReactions?: ApiReactionCount[];
  reactionsLimit?: number;
  isReady?: boolean;
  isCurrentUserPremium?: boolean;
  canPlayAnimatedEmojis?: boolean;
  className?: string;
  isInSavedMessages?: boolean;
  isInStoryViewer?: boolean;
  onToggleReaction: (reaction: ApiReaction) => void;
  onShowMore: (position: IAnchorPosition) => void;
};

const cn = createClassNameBuilder('ReactionSelector');
const REACTIONS_AMOUNT = 7;
// Without a reaction catalog any emoji is a reaction, as in Signal; these come first
// (Signal Desktop `DEFAULT_PREFERRED_REACTION_EMOJI` in `ts/axo/emoji.std.ts`)
const DEFAULT_EMOJI_REACTIONS: ApiReactionEmoji[] = ['❤️', '👍', '👎', '😂', '😮', '😢'].map((emoticon) => ({
  type: 'emoji', emoticon,
}));
const FADE_IN_DELAY = 20;

const ReactionSelector = ({
  allAvailableReactions,
  topReactions,
  defaultTagReactions,
  enabledReactions,
  currentReactions,
  reactionsLimit,
  isPrivate,
  isReady,
  canPlayAnimatedEmojis,
  className,
  isCurrentUserPremium,
  isInSavedMessages,
  isInStoryViewer,
  onToggleReaction,
  onShowMore,
}: OwnProps) => {
  const ref = useRef<HTMLDivElement>();
  const lang = useLang();

  const areReactionsLocked = isInSavedMessages && !isCurrentUserPremium && !isInStoryViewer;

  const shouldUseCurrentReactions = Boolean(reactionsLimit
    && currentReactions && currentReactions.length >= reactionsLimit);
  const hasReactionCatalog = Boolean(allAvailableReactions?.length);

  const availableReactions = useMemo(() => {
    const reactions = (() => {
      if (shouldUseCurrentReactions) return currentReactions?.map((reaction) => reaction.reaction);
      if (isInSavedMessages) return defaultTagReactions;
      if (enabledReactions?.type === 'some') return enabledReactions.allowed;
      if (!hasReactionCatalog) return DEFAULT_EMOJI_REACTIONS;
      return allAvailableReactions?.map((reaction) => reaction.reaction);
    })();

    const filteredReactions: RenderableReactions = reactions?.map((reaction) => {
      const isCustomReaction = reaction.type === 'custom';
      const availableReaction = allAvailableReactions?.find((r) => isSameReaction(r.reaction, reaction));

      const isPlainEmoji = !hasReactionCatalog && reaction.type === 'emoji';
      if ((!isCustomReaction && !availableReaction && !isPlainEmoji) || availableReaction?.isInactive) return undefined;

      if (!isPrivate && !shouldUseCurrentReactions
        && (!enabledReactions || !canSendReaction(reaction, enabledReactions))) {
        return undefined;
      }

      return availableReaction || reaction;
    }).filter(Boolean) || [];

    return sortReactions(filteredReactions, topReactions);
  }, [
    allAvailableReactions, currentReactions, defaultTagReactions, enabledReactions, isInSavedMessages, isPrivate,
    topReactions, shouldUseCurrentReactions, hasReactionCatalog,
  ]);

  const reactionsToRender = useMemo(() => {
    // Component can fit one more if we do not need show more button
    return availableReactions.length === REACTIONS_AMOUNT + 1
      ? availableReactions
      : availableReactions.slice(0, REACTIONS_AMOUNT);
  }, [availableReactions]);
  // Without a catalog, more opens the full emoji set
  const withMoreButton = reactionsToRender.length < availableReactions.length
    || (!hasReactionCatalog && !shouldUseCurrentReactions && !isInSavedMessages);

  const userReactionIndexes = useMemo(() => {
    const chosenReactions = currentReactions?.filter(({ chosenOrder }) => chosenOrder !== undefined) || [];
    return new Set(chosenReactions.map(({ reaction }) => (
      reactionsToRender.findIndex((r) => r && isSameReaction('reaction' in r ? r.reaction : r, reaction))
    )));
  }, [currentReactions, reactionsToRender]);

  const handleShowMoreClick = useLastCallback(() => {
    const bound = ref.current?.getBoundingClientRect() || { x: 0, y: 0 };
    onShowMore({
      x: bound.x,
      y: bound.y,
    });
  });

  const hintText = useMemo(() => {
    if (isInSavedMessages) {
      if (!isCurrentUserPremium) {
        return lang('SubscribeTagAbout', { link: lang('SubscribeTagLink') });
      }

      return lang('SavedTagReactionsHint2');
    }

    if (isInStoryViewer) {
      return lang('StoryReactionsHint');
    }

    return undefined;
  }, [isCurrentUserPremium, isInSavedMessages, isInStoryViewer, lang]);

  if (!reactionsToRender.length) return undefined;

  return (
    <div className={buildClassName(cn('&'), className)} ref={ref}>
      <div className={cn('bubble-small', lang.isRtl && 'isRtl')} />
      <div className={cn('items-wrapper')}>
        <div className={cn('bubble-big', lang.isRtl && 'isRtl')} />
        <div className={cn('items')}>
          {Boolean(hintText) && <div className={cn('hint')}>{hintText}</div>}
          <div className={cn('reactions')} dir={lang.isRtl ? 'rtl' : undefined}>
            {reactionsToRender.map((reaction, i) => (
              'reaction' in reaction ? (
                <ReactionSelectorReaction
                  key={getReactionKey(reaction.reaction)}
                  isReady={isReady}
                  onToggleReaction={onToggleReaction}
                  reaction={reaction}
                  noAppearAnimation={!canPlayAnimatedEmojis}
                  chosen={userReactionIndexes.has(i)}
                  isLocked={areReactionsLocked}
                />
              ) : (
                <ReactionSelectorCustomReaction
                  key={getReactionKey(reaction)}
                  isReady={isReady}
                  onToggleReaction={onToggleReaction}
                  reaction={reaction}
                  noAppearAnimation={!canPlayAnimatedEmojis}
                  chosen={userReactionIndexes.has(i)}
                  isLocked={areReactionsLocked}
                  style={`--_animation-delay: ${(REACTIONS_AMOUNT - i) * FADE_IN_DELAY}ms`}
                />
              )
            ))}
            {withMoreButton && (
              <Button
                color="translucent"
                className={cn('show-more')}
                onClick={handleShowMoreClick}
                iconName="down"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(ReactionSelector);
