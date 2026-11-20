import { memo } from '../../../../lib/teact/teact';

import type {
  ApiPeer, ApiReaction, ApiReactionCount,
} from '../../../../api/types';
import type { ObserveFn } from '../../../../hooks/useIntersectionObserver';

import { isReactionChosen } from '../../../../global/helpers';
import buildClassName from '../../../../util/buildClassName';
import { formatIntegerCompact } from '../../../../util/text/textFormat';
import { REM } from '../../../common/helpers/mediaDimensions';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import AnimatedCounter from '../../../common/AnimatedCounter';
import AvatarList from '../../../common/AvatarList';
import ReactionAnimatedEmoji from '../../../common/reactions/ReactionAnimatedEmoji';
import Button from '../../../ui/Button';

import styles from './ReactionButton.module.scss';

const REACTION_SIZE = 1.25 * REM;

type OwnProps = {
  reaction: ApiReactionCount;
  containerId: string;
  isOwnMessage?: boolean;
  recentReactors?: ApiPeer[];
  className?: string;
  chosenClassName?: string;
  isOutside?: boolean;
  observeIntersection?: ObserveFn;
  onClick?: (reaction: ApiReaction) => void;
};

const ReactionButton = ({
  reaction,
  containerId,
  isOwnMessage,
  recentReactors,
  className,
  chosenClassName,
  isOutside,
  observeIntersection,
  onClick,
}: OwnProps) => {
  const lang = useLang();

  const handleClick = useLastCallback(() => {
    onClick?.(reaction.reaction);
  });

  return (
    <Button
      className={buildClassName(
        styles.root,
        isOwnMessage && styles.own,
        isOutside && styles.outside,
        isReactionChosen(reaction) && styles.chosen,
        isReactionChosen(reaction) && chosenClassName,
        className,
      )}
      size="tiny"
      onClick={handleClick}
    >
      <ReactionAnimatedEmoji
        className={styles.animatedEmoji}
        containerId={containerId}
        reaction={reaction.reaction}
        size={REACTION_SIZE}
        observeIntersection={observeIntersection}
      />
      {recentReactors?.length ? (
        <AvatarList size="mini" peers={recentReactors} />
      ) : (
        <AnimatedCounter
          text={formatIntegerCompact(lang, reaction.count)}
          className={styles.counter}
        />
      )}
    </Button>
  );
};

export default memo(ReactionButton);
