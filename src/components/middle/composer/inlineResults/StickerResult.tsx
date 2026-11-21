import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';

import type { ApiBotInlineMediaResult } from '../../../../api/types';
import type { ObserveFn } from '../../../../hooks/useIntersectionObserver';

import { STICKER_SIZE_INLINE_BOT_RESULT } from '../../../../config';

import StickerButton from '../../../common/StickerButton';

type OwnProps = {
  inlineResult: ApiBotInlineMediaResult;
  isSavedMessages?: boolean;
  observeIntersection: ObserveFn;
  onClick: (result: ApiBotInlineMediaResult, isSilent?: boolean, shouldSchedule?: boolean) => void;
};

const StickerResult: FC<OwnProps> = ({
  inlineResult,
  isSavedMessages,
  observeIntersection,
  onClick,
}) => {
  const { sticker } = inlineResult;

  if (!sticker) {
    return undefined;
  }

  return (
    <StickerButton
      sticker={sticker}
      size={STICKER_SIZE_INLINE_BOT_RESULT}
      observeIntersection={observeIntersection}
      title={sticker.emoji}
      className="chat-item-clickable"
      onClick={onClick}
      clickArg={inlineResult}
      isSavedMessages={isSavedMessages}
      canViewSet
    />
  );
};

export default memo(StickerResult);
