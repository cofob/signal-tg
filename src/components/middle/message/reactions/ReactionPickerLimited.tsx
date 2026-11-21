import {
  memo,
  useMemo,
} from '../../../../lib/teact/teact';
import { withGlobal } from '../../../../global';

import type {
  ApiAvailableReaction, ApiChatReactions, ApiMessage,
  ApiReaction,
} from '../../../../api/types';

import {
  getReactionKey, sortReactions,
} from '../../../../global/helpers';
import { selectChatFullInfo } from '../../../../global/selectors';
import buildClassName from '../../../../util/buildClassName';
import { REM } from '../../../common/helpers/mediaDimensions';

import useAppLayout from '../../../../hooks/useAppLayout';
import useWindowSize from '../../../../hooks/window/useWindowSize';

import ReactionEmoji from '../../../common/reactions/ReactionEmoji';
import SharedCanvas from '../../../common/SharedCanvas';

import styles from './ReactionPickerLimited.module.scss';

type OwnProps = {
  chatId: string;
  loadAndPlay: boolean;
  selectedReactionIds?: string[];
  message?: ApiMessage;
  onReactionSelect: (reaction: ApiReaction) => void;
};

type StateProps = {
  enabledReactions?: ApiChatReactions;
  availableReactions?: ApiAvailableReaction[];
  topReactions: ApiReaction[];
  reactionsLimit?: number;
};

const REACTION_SIZE = 36;
const GRID_GAP_THRESHOLD = 600;
const MODAL_PADDING_SIZE_REM = 0.5;
const MODAL_MAX_HEIGHT_REM = 18;
const MODAL_MAX_WIDTH_REM = 26.25;
const GRID_GAP_DESKTOP_REM = 0.625;
const GRID_GAP_MOBILE_REM = 0.5;

const ReactionPickerLimited = ({
  loadAndPlay,
  enabledReactions,
  availableReactions,
  topReactions,
  selectedReactionIds,
  message,
  reactionsLimit,
  onReactionSelect,
}: OwnProps & StateProps) => {
  const { width: windowWidth } = useWindowSize();
  const { isTouchScreen } = useAppLayout();

  const currentReactions = message?.reactions?.results;

  const shouldUseCurrentReactions = reactionsLimit && currentReactions
    && currentReactions.length >= reactionsLimit;

  const allAvailableReactions = useMemo(() => {
    if (shouldUseCurrentReactions) {
      return currentReactions.map(({ reaction }) => reaction);
    }

    if (!enabledReactions) {
      return [];
    }

    if (enabledReactions.type === 'all') {
      const reactionsToSort = (availableReactions || []).map(({ reaction }) => reaction);
      return sortReactions(reactionsToSort, topReactions);
    }

    return sortReactions(enabledReactions.allowed, topReactions);
  }, [
    availableReactions, enabledReactions, topReactions, shouldUseCurrentReactions, currentReactions,
  ]);

  const pickerHeight = useMemo(() => {
    const pickerWidth = Math.min(MODAL_MAX_WIDTH_REM * REM, windowWidth);
    const gapWidth = (windowWidth > GRID_GAP_THRESHOLD ? GRID_GAP_DESKTOP_REM : GRID_GAP_MOBILE_REM) * REM;
    const availableWidth = pickerWidth - MODAL_PADDING_SIZE_REM * REM;

    const itemsInRow = Math.floor((availableWidth + gapWidth) / (REACTION_SIZE + gapWidth));
    const rowsCount = Math.ceil(allAvailableReactions.length / itemsInRow);

    const pickerMaxHeight = rowsCount * REACTION_SIZE + (rowsCount - 1) * gapWidth + MODAL_PADDING_SIZE_REM * REM * 2;

    return Math.min(MODAL_MAX_HEIGHT_REM * REM, pickerMaxHeight);
  }, [allAvailableReactions.length, windowWidth]);

  return (
    <div className={styles.root} style={`height: ${pickerHeight}px`}>
      <div className={buildClassName(styles.wrapper, isTouchScreen ? 'no-scrollbar' : 'custom-scroll')}>
        <div className="symbol-set-container shared-canvas-container">
          <SharedCanvas>
            {allAvailableReactions.map((reaction) => {
              const reactionId = getReactionKey(reaction);
              const isSelected = reactionId ? selectedReactionIds?.includes(reactionId) : undefined;

              return (
                <ReactionEmoji
                  key={reactionId}
                  reaction={reaction}
                  isSelected={isSelected}
                  loadAndPlay={loadAndPlay}
                  availableReactions={availableReactions}
                  onClick={onReactionSelect}
                />
              );
            })}
          </SharedCanvas>
        </div>
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const { availableReactions, topReactions } = global.reactions;

    const { maxUniqueReactions } = global.appConfig;
    const { enabledReactions } = selectChatFullInfo(global, chatId) || {};

    return {
      enabledReactions,
      availableReactions,
      topReactions,
      reactionsLimit: maxUniqueReactions,
    };
  },
)(ReactionPickerLimited));
