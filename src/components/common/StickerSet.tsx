import {
  memo, useEffect, useMemo, useRef, useState,
} from '../../lib/teact/teact';
import { getActions } from '../../global';

import type {
  ApiAvailableReaction, ApiReaction, ApiSticker,
} from '../../api/types';
import type { ObserveFn } from '../../hooks/useIntersectionObserver';
import type { StickerSetOrReactionsSetOrRecent } from '../../types';

import {
  DEFAULT_STATUS_ICON_ID,
  EMOJI_SIZE_PICKER,
  FAVORITE_SYMBOL_SET_ID,
  POPULAR_SYMBOL_SET_ID,
  RECENT_SYMBOL_SET_ID,
  STICKER_SIZE_PICKER,
} from '../../config';
import { getIsStickerSetInstalled, getReactionKey } from '../../global/helpers';
import buildClassName from '../../util/buildClassName';

import useAppLayout from '../../hooks/useAppLayout';
import useFlag from '../../hooks/useFlag';
import { useIsIntersecting } from '../../hooks/useIntersectionObserver';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import useMediaTransitionDeprecated from '../../hooks/useMediaTransitionDeprecated';
import useResizeObserver from '../../hooks/useResizeObserver';
import useWindowSize from '../../hooks/window/useWindowSize';

import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Icon from './icons/Icon';
import ReactionEmoji from './reactions/ReactionEmoji';
import SharedCanvas from './SharedCanvas';
import StickerButton from './StickerButton';

type OwnProps = {
  stickerSet: StickerSetOrReactionsSetOrRecent;
  loadAndPlay: boolean;
  index: number;
  idPrefix: string;
  isNearActive: boolean;
  favoriteStickers?: ApiSticker[];
  isSavedMessages?: boolean;
  isStatusPicker?: boolean;
  isReactionPicker?: boolean;
  shouldHideHeader?: boolean;
  selectedReactionIds?: string[];
  withSelectionOrder?: boolean;
  withDefaultStatusIcon?: boolean;
  isChatEmojiSet?: boolean;
  isTranslucent?: boolean;
  withInstantThumbs?: boolean;
  noContextMenus?: boolean;
  noAddButton?: boolean;
  forcePlayback?: boolean;
  observeIntersection?: ObserveFn;
  observeIntersectionForPlayingItems: ObserveFn;
  observeIntersectionForShowingItems: ObserveFn;
  availableReactions?: ApiAvailableReaction[];
  onStickerSelect?: (sticker: ApiSticker, isSilent?: boolean, shouldSchedule?: boolean) => void;
  onReactionSelect?: (reaction: ApiReaction) => void;
  onStickerUnfave?: (sticker: ApiSticker) => void;
  onStickerFave?: (sticker: ApiSticker) => void;
  onStickerRemoveRecent?: (sticker: ApiSticker) => void;
  onDismiss?: NoneToVoidFunction;
};

const ITEMS_PER_ROW_FALLBACK = 8;
const ITEMS_MOBILE_PER_ROW_FALLBACK = 7;
const ITEMS_MINI_MOBILE_PER_ROW_FALLBACK = 6;
const MOBILE_WIDTH_THRESHOLD_PX = 440;
const MINI_MOBILE_WIDTH_THRESHOLD_PX = 362;

const StickerSet = ({
  stickerSet,
  loadAndPlay,
  index,
  idPrefix,
  isNearActive,
  favoriteStickers,
  availableReactions,
  isSavedMessages,
  isStatusPicker,
  isReactionPicker,
  shouldHideHeader,
  selectedReactionIds,
  withSelectionOrder,
  withDefaultStatusIcon,
  isChatEmojiSet,
  isTranslucent,
  withInstantThumbs,
  noContextMenus,
  noAddButton,
  forcePlayback,
  observeIntersection,
  observeIntersectionForPlayingItems,
  observeIntersectionForShowingItems,
  onReactionSelect,
  onStickerSelect,
  onStickerUnfave,
  onStickerFave,
  onStickerRemoveRecent,
  onDismiss,
}: OwnProps) => {
  const {
    clearRecentStickers,
    clearRecentCustomEmoji,
    toggleStickerSet,
    loadStickers,
  } = getActions();

  const ref = useRef<HTMLDivElement>();

  const lang = useLang();
  const { width: windowWidth } = useWindowSize();
  const [isConfirmModalOpen, openConfirmModal, closeConfirmModal] = useFlag();
  const { isMobile } = useAppLayout();

  const [itemsPerRow, setItemsPerRow] = useState(() => getItemsPerRowFallback(windowWidth));

  const isIntersecting = useIsIntersecting(ref, observeIntersection ?? observeIntersectionForShowingItems);
  const transitionClassNames = useMediaTransitionDeprecated(isIntersecting || isNearActive || withInstantThumbs);

  // `isNearActive` is set in advance during animation, but it is not reliable for short sets
  const shouldRender = isNearActive || isIntersecting;

  const stickerMarginPx = isMobile ? 8 : 4;
  const emojiMarginPx = isMobile ? 8 : 10;
  const emojiVerticalMarginPx = isMobile ? 8 : 4;
  const isRecent = stickerSet.id === RECENT_SYMBOL_SET_ID;
  const isFavorite = stickerSet.id === FAVORITE_SYMBOL_SET_ID;
  const isPopular = stickerSet.id === POPULAR_SYMBOL_SET_ID;
  const isEmoji = stickerSet.isEmoji;

  const handleClearRecent = useLastCallback(() => {
    if (isEmoji) {
      clearRecentCustomEmoji();
    } else {
      clearRecentStickers();
    }
    closeConfirmModal();
  });

  const handleAddClick = useLastCallback(() => {
    toggleStickerSet({
      stickerSetId: stickerSet.id,
    });
  });

  const handleDefaultStatusIconClick = useLastCallback(() => {
    onStickerSelect?.({
      mediaType: 'sticker',
      id: DEFAULT_STATUS_ICON_ID,
      isLottie: false,
      isVideo: false,
      stickerSetInfo: {
        shortName: 'dummy',
      },
    } satisfies ApiSticker);
  });

  const itemSize = isEmoji ? EMOJI_SIZE_PICKER : STICKER_SIZE_PICKER;
  const margin = isEmoji ? emojiMarginPx : stickerMarginPx;
  const verticalMargin = isEmoji ? emojiVerticalMarginPx : stickerMarginPx;

  const calculateItemsPerRow = useLastCallback((width: number) => {
    if (!width) {
      return getItemsPerRowFallback(windowWidth);
    }

    return Math.floor((width + margin) / (itemSize + margin));
  });

  const handleResize = useLastCallback((entry: ResizeObserverEntry) => {
    setItemsPerRow(calculateItemsPerRow(entry.contentRect.width));
  });

  useResizeObserver(ref, handleResize);

  useEffect(() => {
    if (!ref.current) return;
    setItemsPerRow(calculateItemsPerRow(ref.current.clientWidth));
  }, [calculateItemsPerRow]);

  useEffect(() => {
    if (shouldRender && !stickerSet.stickers?.length && !stickerSet.reactions?.length && stickerSet.accessHash) {
      loadStickers({
        stickerSetInfo: {
          id: stickerSet.id,
          accessHash: stickerSet.accessHash,
        },
      });
    }
  }, [shouldRender, loadStickers, stickerSet]);

  const isInstalled = getIsStickerSetInstalled(stickerSet) && !stickerSet.isArchived;

  const canCut = !isInstalled && stickerSet.id !== RECENT_SYMBOL_SET_ID
    && stickerSet.id !== POPULAR_SYMBOL_SET_ID && !isChatEmojiSet;

  const [isCut, , expand] = useFlag(canCut);
  const itemsBeforeCutout = itemsPerRow * 3 - 1;
  const totalItemsCount = withDefaultStatusIcon ? stickerSet.count + 1 : stickerSet.count;

  const itemHeight = itemSize + verticalMargin;
  const heightWhenCut = Math.ceil(Math.min(itemsBeforeCutout, totalItemsCount) / itemsPerRow)
    * itemHeight - verticalMargin;
  const height = isCut ? heightWhenCut : Math.ceil(totalItemsCount / itemsPerRow) * itemHeight - verticalMargin;

  const favoriteStickerIdsSet = useMemo(() => (
    favoriteStickers ? new Set(favoriteStickers.map(({ id }) => id)) : undefined
  ), [favoriteStickers]);
  const withAddSetButton = !noAddButton && !shouldHideHeader && !isRecent
    && isEmoji && !isPopular && !isChatEmojiSet && !isInstalled;
  return (
    <div
      ref={ref}
      key={stickerSet.id}
      id={`${idPrefix}-${index}`}
      className="symbol-set"
    >
      {!shouldHideHeader && (
        <div className="symbol-set-header">
          <p className={buildClassName('symbol-set-title', withAddSetButton && 'symbol-set-title-external')}>
            <span className="symbol-set-name">{stickerSet.title}</span>
            {isChatEmojiSet && (
              <span className="symbol-set-chat">{lang('GroupEmoji')}</span>
            )}
            {withAddSetButton && Boolean(stickerSet.stickers) && (
              <span className="symbol-set-amount">
                {lang(isEmoji ? 'EmojiCount' : 'StickerPackStickerCount', {
                  count: lang.number(stickerSet.stickers.length),
                }, { pluralValue: stickerSet.stickers.length })}
              </span>
            )}
          </p>
          {isRecent && (
            <Icon className="symbol-set-remove" name="close" onClick={openConfirmModal} />
          )}
          {withAddSetButton && (
            <Button
              className="symbol-set-add-button"
              onClick={handleAddClick}
              pill
              size="tiny"
              fluid
            >
              {lang('Add')}
            </Button>
          )}
        </div>
      )}
      <div
        className={buildClassName(
          'symbol-set-container shared-canvas-container',
          transitionClassNames,
        )}
        style={`${withInstantThumbs ? 'min-height' : 'height'}: ${height}px;`}
      >
        <SharedCanvas>
          {withDefaultStatusIcon && (
            <Button
              className="StickerButton custom-emoji status-default"
              color="translucent"
              onClick={handleDefaultStatusIconClick}
              key="default-status-icon"
              iconName="star"
            />
          )}
          {shouldRender && stickerSet.reactions?.map((reaction) => {
            const reactionId = getReactionKey(reaction);
            const selectionIndex = selectedReactionIds?.indexOf(reactionId) ?? -1;

            return (
              <ReactionEmoji
                key={`${stickerSet.id}_${reactionId}`}
                reaction={reaction}
                isSelected={selectionIndex !== -1}
                selectionOrder={withSelectionOrder && selectionIndex !== -1 ? selectionIndex + 1 : undefined}
                loadAndPlay={loadAndPlay}
                availableReactions={availableReactions}
                observeIntersection={observeIntersectionForPlayingItems}
                onClick={onReactionSelect!}
                forcePlayback={forcePlayback}
              />
            );
          })}
          {shouldRender && stickerSet.stickers?.slice(0, isCut ? itemsBeforeCutout : stickerSet.stickers.length)
            .map((sticker) => {
              const reactionId = sticker.isCustomEmoji
                ? getReactionKey({ type: 'custom', documentId: sticker.id })
                : sticker.emoji && getReactionKey({ type: 'emoji', emoticon: sticker.emoji });
              const selectionIndex = reactionId ? selectedReactionIds?.indexOf(reactionId) ?? -1 : -1;

              const component = (
                <StickerButton
                  key={sticker.id}
                  sticker={sticker}
                  size={itemSize}
                  observeIntersection={observeIntersectionForPlayingItems}
                  observeIntersectionForShowing={observeIntersectionForShowingItems}
                  noPlay={!loadAndPlay}
                  isSavedMessages={isSavedMessages}
                  isStatusPicker={isStatusPicker}
                  canViewSet
                  noContextMenu={noContextMenus}
                  withTranslucentThumb={isTranslucent}
                  withInstantThumb={withInstantThumbs}
                  onClick={onStickerSelect}
                  clickArg={sticker}
                  isSelected={selectionIndex !== -1}
                  selectionOrder={withSelectionOrder && selectionIndex !== -1 ? selectionIndex + 1 : undefined}
                  onUnfaveClick={isFavorite && favoriteStickerIdsSet?.has(sticker.id) ? onStickerUnfave : undefined}
                  onFaveClick={!favoriteStickerIdsSet?.has(sticker.id) ? onStickerFave : undefined}
                  onRemoveRecentClick={isRecent ? onStickerRemoveRecent : undefined}
                  onDismiss={onDismiss}
                  forcePlayback={forcePlayback}
                />
              );

              return component;
            })}
          {isCut && totalItemsCount > itemsBeforeCutout && (
            <Button
              className="StickerButton custom-emoji set-expand"
              round
              color="translucent"
              onClick={expand}
              key="more"
            >
              +
              {totalItemsCount - itemsBeforeCutout}
            </Button>
          )}
        </SharedCanvas>
      </div>

      {isRecent && (
        <ConfirmDialog
          text={lang('ClearRecentStickersAlertMessage')}
          isOpen={isConfirmModalOpen}
          onClose={closeConfirmModal}
          confirmHandler={handleClearRecent}
          confirmIsDestructive
        />
      )}
    </div>
  );
};

export default memo(StickerSet);

function getItemsPerRowFallback(windowWidth: number): number {
  return windowWidth > MOBILE_WIDTH_THRESHOLD_PX
    ? ITEMS_PER_ROW_FALLBACK
    : (windowWidth < MINI_MOBILE_WIDTH_THRESHOLD_PX
      ? ITEMS_MINI_MOBILE_PER_ROW_FALLBACK
      : ITEMS_MOBILE_PER_ROW_FALLBACK);
}
