import { memo, useMemo, useRef } from '../../../lib/teact/teact';

import type { ApiAvailableReaction, ApiReaction } from '../../../api/types';
import type { ObserveFn } from '../../../hooks/useIntersectionObserver';

import { EMOJI_SIZE_PICKER } from '../../../config';
import { getDocumentMediaHash, isSameReaction } from '../../../global/helpers';
import buildClassName from '../../../util/buildClassName';

import useCoordsInSharedCanvas from '../../../hooks/useCoordsInSharedCanvas';
import useLastCallback from '../../../hooks/useLastCallback';
import useMedia from '../../../hooks/useMedia';
import useMediaTransitionDeprecated from '../../../hooks/useMediaTransitionDeprecated';
import useDevicePixelRatio from '../../../hooks/window/useDevicePixelRatio';

import AnimatedIconWithPreview from '../AnimatedIconWithPreview';
import CustomEmoji from '../CustomEmoji';
import SelectionOrderBadge from '../SelectionOrderBadge';

import styles from './ReactionEmoji.module.scss';

type OwnProps = {
  reaction: ApiReaction;
  availableReactions?: ApiAvailableReaction[];
  className?: string;
  isSelected?: boolean;
  selectionOrder?: number;
  loadAndPlay?: boolean;
  observeIntersection?: ObserveFn;
  forcePlayback?: boolean;
  onClick: (reaction: ApiReaction) => void;
};

const ReactionEmoji = ({
  reaction,
  availableReactions,
  isSelected,
  selectionOrder,
  loadAndPlay,
  observeIntersection,
  forcePlayback,
  onClick,
}: OwnProps) => {
  const ref = useRef<HTMLDivElement>();
  const isCustom = reaction.type === 'custom';
  const availableReaction = useMemo(() => (
    availableReactions?.find((available) => isSameReaction(available.reaction, reaction))
  ), [availableReactions, reaction]);
  const thumbDataUri = availableReaction?.staticIcon?.thumbnail?.dataUri;
  const animationId = availableReaction?.selectAnimation?.id;
  const { sharedCanvasRef, coords } = useCoordsInSharedCanvas(ref);
  const dpr = useDevicePixelRatio();
  const mediaData = useMedia(
    availableReaction?.selectAnimation ? getDocumentMediaHash(availableReaction.selectAnimation, 'full') : undefined,
    !animationId,
  );

  const handleClick = useLastCallback(() => {
    onClick(reaction);
  });

  const transitionClassNames = useMediaTransitionDeprecated(mediaData);
  const fullClassName = buildClassName(
    styles.root,
    isSelected && styles.selected,
    !isCustom && 'sticker-reaction',
  );

  return (
    <div
      ref={ref}
      className={fullClassName}
      onClick={handleClick}
      title={availableReaction?.title}
      data-sticker-id={isCustom ? reaction.documentId : undefined}
    >
      {isCustom ? (
        <CustomEmoji
          ref={ref}
          documentId={reaction.documentId}
          size={EMOJI_SIZE_PICKER}
          noPlay={!loadAndPlay}
          observeIntersectionForPlaying={observeIntersection}
          withTranslucentThumb
          forceAlways={forcePlayback}
        />
      ) : (
        <AnimatedIconWithPreview
          key={dpr}
          tgsUrl={mediaData}
          thumbDataUri={thumbDataUri}
          play={loadAndPlay}
          noLoop={false}
          size={EMOJI_SIZE_PICKER}
          isLowPriority
          className={transitionClassNames}
          sharedCanvas={sharedCanvasRef?.current || undefined}
          sharedCanvasCoords={coords}
          forceAlways={forcePlayback}
        />
      )}
      {selectionOrder !== undefined && <SelectionOrderBadge order={selectionOrder} />}
    </div>
  );
};

export default memo(ReactionEmoji);
