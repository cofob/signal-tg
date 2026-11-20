import { memo } from '../../../../lib/teact/teact';

import type { ApiReaction, ApiReactionCustomEmoji, ApiReactionEmoji } from '../../../../api/types';

import buildClassName from '../../../../util/buildClassName';
import { REM } from '../../../common/helpers/mediaDimensions';

import useLastCallback from '../../../../hooks/useLastCallback';

import CustomEmoji from '../../../common/CustomEmoji';
import Icon from '../../../common/icons/Icon';
import ReactionStaticEmoji from '../../../common/reactions/ReactionStaticEmoji';

import styles from './ReactionSelectorReaction.module.scss';

const REACTION_SIZE = 2 * REM;

type OwnProps = {
  // Emoji reactions without catalog animations, as Signal allows any emoji
  reaction: ApiReactionCustomEmoji | ApiReactionEmoji;
  chosen?: boolean;
  isReady?: boolean;
  noAppearAnimation?: boolean;
  style?: string;
  isLocked?: boolean;
  onToggleReaction: (reaction: ApiReaction) => void;
};

const ReactionSelectorCustomReaction = ({
  reaction,
  chosen,
  isReady,
  noAppearAnimation,
  style,
  isLocked,
  onToggleReaction,
}: OwnProps) => {
  const handleClick = useLastCallback(() => {
    onToggleReaction(reaction);
  });

  return (
    <div
      className={buildClassName(
        styles.root,
        styles.custom,
        chosen && styles.chosen,
        !noAppearAnimation && isReady && styles.customAnimated,
        noAppearAnimation && styles.visible,
      )}
      style={style}
      onClick={handleClick}
    >
      {reaction.type === 'emoji' && <ReactionStaticEmoji reaction={reaction} size={REACTION_SIZE} />}
      {reaction.type === 'custom' && (
        <CustomEmoji
          documentId={reaction.documentId}
          size={REACTION_SIZE}
        />
      )}
      {isLocked && (
        <Icon className={styles.lock} name="lock-filled" />
      )}
    </div>
  );
};

export default memo(ReactionSelectorCustomReaction);
