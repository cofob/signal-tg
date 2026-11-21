import {
  memo, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from '../../../lib/teact/teact';
import { setExtraStyles } from '../../../lib/teact/teact-dom';
import { getActions, withGlobal } from '../../../global';

import type { ApiChat, ApiSticker, ApiStickerSet } from '../../../api/types';
import type { StickerSetOrReactionsSetOrRecent, ThreadId } from '../../../types';

import {
  BASE_EMOJI_KEYWORD_LANG,
  RECENT_SYMBOL_SET_ID,
  SLIDE_TRANSITION_DURATION,
  STICKER_PICKER_MAX_SHARED_COVERS,
  STICKER_SIZE_PICKER,
  STICKER_SIZE_PICKER_HEADER,
} from '../../../config';
import { requestForcedReflow } from '../../../lib/fasterdom/fasterdom';
import { getIsStickerSetInstalled } from '../../../global/helpers';
import { selectChat, selectIsChatWithSelf, selectShouldLoopStickers } from '../../../global/selectors';
import { selectLanguageCode } from '../../../global/selectors/settings';
import animateHorizontalScroll from '../../../util/animateHorizontalScroll';
import { IS_TOUCH_ENV } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';
import { waitForTransitionEnd } from '../../../util/cssAnimationEndListeners';
import { pickTruthy, uniqueByField } from '../../../util/iteratees';
import { MEMO_EMPTY_ARRAY } from '../../../util/memo';
import resetScroll from '../../../util/resetScroll';
import searchWords from '../../../util/text/searchWords';
import { REM } from '../../common/helpers/mediaDimensions';

import { useTransitionActiveKey } from '../../../hooks/animations/useTransitionActiveKey';
import useDerivedState from '../../../hooks/useDerivedState';
import useHorizontalScroll from '../../../hooks/useHorizontalScroll';
import { useIntersectionObserver } from '../../../hooks/useIntersectionObserver';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import useScrolledState from '../../../hooks/useScrolledState';
import useSendMessageAction from '../../../hooks/useSendMessageAction';
import useSyncEffect from '../../../hooks/useSyncEffect';
import { useStickerPickerObservers } from '../../common/hooks/useStickerPickerObservers';
import useAsyncRendering from '../../right/hooks/useAsyncRendering';
import useEmojiSearch from './hooks/useEmojiSearch';

import CollapsibleSection from '../../common/CollapsibleSection';
import FoundPacksRow from '../../common/FoundPacksRow';
import Icon from '../../common/icons/Icon';
import InlineStickerSetView, { StickerSetToggleButton } from '../../common/InlineStickerSetView';
import SharedCanvas from '../../common/SharedCanvas';
import StickerButton from '../../common/StickerButton';
import StickerSet from '../../common/StickerSet';
import TrendingPacksRow from '../../common/TrendingPacksRow';
import Button from '../../ui/Button';
import Loading from '../../ui/Loading';
import Transition from '../../ui/Transition';
import EmojiSearch from './EmojiSearch';
import StickerSetCover from './StickerSetCover';

import styles from './StickerPicker.module.scss';

type OwnProps = {
  chatId?: string;
  threadId?: ThreadId;
  className: string;
  isHidden?: boolean;
  isTranslucent?: boolean;
  loadAndPlay: boolean;
  canSendStickers?: boolean;
  noContextMenus?: boolean;
  noRenderDelay?: boolean;
  withInstantThumbs?: boolean;
  idPrefix: string;
  onStickerSelect: (
    sticker: ApiSticker, isSilent?: boolean, shouldSchedule?: boolean, canUpdateStickerSetsOrder?: boolean,
  ) => void;
};

type StateProps = {
  chat?: ApiChat;
  recentStickers: ApiSticker[];
  stickerSetsById: Record<string, ApiStickerSet>;
  addedSetIds?: string[];
  featuredIds?: string[];
  hiddenTrendingSetId?: string;
  canAnimate?: boolean;
  isSavedMessages?: boolean;
  baseEmojiKeywords?: Record<string, string[]>;
  emojiKeywords?: Record<string, string[]>;
};

const HEADER_BUTTON_WIDTH = 2.5 * REM; // px (including margin)
const FOUND_PACK_COVER_SIZE = 3 * REM;
const TRENDING_COVER_SIZE = 1.5 * REM;
const TRENDING_DISMISS_DURATION = 250;
const TRENDING_DISMISS_FALLBACK_MS = TRENDING_DISMISS_DURATION + 100;
const RESULTS_INTERSECTION_THROTTLE = 200;

const StickerPicker = ({
  chatId,
  chat,
  threadId,
  className,
  isHidden,
  isTranslucent,
  loadAndPlay,
  canSendStickers,
  noRenderDelay,
  withInstantThumbs,
  recentStickers,
  addedSetIds,
  featuredIds,
  hiddenTrendingSetId,
  stickerSetsById,
  canAnimate,
  isSavedMessages,
  baseEmojiKeywords,
  emojiKeywords,
  noContextMenus,
  idPrefix,
  onStickerSelect,
}: OwnProps & StateProps) => {
  const {
    loadRecentStickers,
    addRecentSticker,
    removeRecentSticker,
    loadStickers,
    loadFeaturedStickers,
    hideTrendingStickers,
  } = getActions();

  const containerRef = useRef<HTMLDivElement>();
  const headerRef = useRef<HTMLDivElement>();
  const trendingRef = useRef<HTMLDivElement>();

  const {
    handleScroll: handleContentScroll,
    isAtBeginning: shouldHideTopBorder,
  } = useScrolledState();

  const sendMessageAction = useSendMessageAction(chat?.id, threadId);

  const prefix = `${idPrefix}-sticker-set`;
  const {
    activeSetIndex,
    getLastVisibleSetIndex,
    observeIntersectionForSet,
    observeIntersectionForPlayingItems,
    observeIntersectionForShowingItems,
    observeIntersectionForCovers,
    selectStickerSet,
  } = useStickerPickerObservers(containerRef, headerRef, prefix, isHidden);
  const lastVisibleSetIndex = useDerivedState(getLastVisibleSetIndex);

  const lang = useLang();

  const areAddedLoaded = Boolean(addedSetIds);

  const allSets = useMemo(() => {
    if (!addedSetIds) {
      return MEMO_EMPTY_ARRAY;
    }

    const defaultSets = [];

    if (recentStickers.length) {
      defaultSets.push({
        id: RECENT_SYMBOL_SET_ID,
        accessHash: '0',
        title: lang('RecentStickers'),
        stickers: recentStickers,
        count: recentStickers.length,
      });
    }

    return [
      ...defaultSets,
      ...Object.values(pickTruthy(stickerSetsById, addedSetIds)),
    ];
  }, [
    addedSetIds,
    stickerSetsById,
    recentStickers,
    lang,
  ]);

  const noPopulatedSets = useMemo(() => (
    areAddedLoaded
    && allSets.filter((set) => set.stickers?.length).length === 0
  ), [allSets, areAddedLoaded]);

  const searchableStickers = useMemo(() => {
    return uniqueByField(allSets.flatMap((set) => set.stickers || []), 'id');
  }, [allSets]);

  const {
    query,
    isSearchActive,
    customResults,
    setQuery,
    markSearchFocused,
    unmarkSearchFocused,
  } = useEmojiSearch({
    baseEmojiKeywords,
    emojiKeywords,
    localStickers: searchableStickers,
    isLocalOnly: true,
    noNativeResults: true,
  });

  // Signal has no sticker search on the server: results are stickers of installed packs with matching emoji, and
  // installed and known packs with matching titles
  const effectiveQuery = query.trim();
  const isShowingSearchResults = Boolean(effectiveQuery);

  const [openedPack, setOpenedPack] = useState<ApiStickerSet | undefined>();
  const pendingSetIndexRef = useRef<number>();
  const [isLocalSectionCollapsed, setIsLocalSectionCollapsed] = useState(false);

  useSyncEffect(() => {
    setIsLocalSectionCollapsed(false);
  }, [effectiveQuery]);
  const openedSet = openedPack && (stickerSetsById[openedPack.id] || openedPack);
  const isOpenedSetLoading = Boolean(openedSet && (openedSet.stickers?.length || 0) < openedSet.count);

  const foundPackSets = useMemo(() => {
    if (!effectiveQuery) return undefined;
    const setIds = [...new Set([...(addedSetIds || []), ...(featuredIds || [])])];
    return Object.values(pickTruthy(stickerSetsById, setIds)).filter(({ title }) => searchWords(title, effectiveQuery));
  }, [addedSetIds, effectiveQuery, featuredIds, stickerSetsById]);

  const contentActiveKey = useTransitionActiveKey([isShowingSearchResults, effectiveQuery, openedSet?.id]);

  const { observe: observeIntersectionForResults } = useIntersectionObserver({
    rootRef: containerRef,
    throttleMs: RESULTS_INTERSECTION_THROTTLE,
  });

  useLayoutEffect(() => {
    if (containerRef.current) {
      resetScroll(containerRef.current, 0);
    }
  }, [isShowingSearchResults, effectiveQuery, openedSet?.id]);

  useEffect(() => {
    if (!loadAndPlay) return;
    loadRecentStickers();
    loadFeaturedStickers();
    if (!canSendStickers) return;
    sendMessageAction({ type: 'chooseSticker' });
  }, [canSendStickers, loadAndPlay, loadRecentStickers, loadFeaturedStickers, sendMessageAction]);

  const trendingSets = useMemo(() => {
    if (!featuredIds?.length || hiddenTrendingSetId === featuredIds[0]) {
      return undefined;
    }

    const sets = featuredIds
      .map((id) => stickerSetsById[id])
      .filter((set) => set && !(getIsStickerSetInstalled(set) && !set.isArchived));

    return sets.length ? sets : undefined;
  }, [featuredIds, hiddenTrendingSetId, stickerSetsById]);

  const canRenderContents = useAsyncRendering([], noRenderDelay ? undefined : SLIDE_TRANSITION_DURATION);
  const shouldRenderContents = areAddedLoaded && canRenderContents && canSendStickers;

  useHorizontalScroll(headerRef, !shouldRenderContents || !headerRef.current);

  // Scroll container and header when active set changes
  useEffect(() => {
    if (!areAddedLoaded) {
      return;
    }

    const header = headerRef.current;
    if (!header) {
      return;
    }

    const newLeft = activeSetIndex * HEADER_BUTTON_WIDTH - (header.offsetWidth / 2 - HEADER_BUTTON_WIDTH / 2);

    animateHorizontalScroll(header, newLeft);
  }, [areAddedLoaded, activeSetIndex]);

  const handleStickerSelect = useLastCallback((sticker: ApiSticker, isSilent?: boolean, shouldSchedule?: boolean) => {
    onStickerSelect(sticker, isSilent, shouldSchedule, true);
    addRecentSticker({ sticker });
  });

  const handleMouseMove = useLastCallback(() => {
    if (!canSendStickers) return;
    sendMessageAction({ type: 'chooseSticker' });
  });

  const handleRemoveRecentSticker = useLastCallback((sticker: ApiSticker) => {
    removeRecentSticker({ sticker });
  });

  const handleFoundPackClick = useLastCallback((set: ApiStickerSet) => {
    setOpenedPack(set);

    if (!stickerSetsById[set.id] || !set.stickers || set.stickers.length < set.count) {
      loadStickers({ stickerSetInfo: { id: set.id, accessHash: set.accessHash } });
    }
  });

  const handlePackBackClick = useLastCallback(() => {
    setOpenedPack(undefined);
  });

  const handleCoverClick = useLastCallback((index: number) => {
    if (!openedSet) {
      selectStickerSet(index);
      return;
    }

    pendingSetIndexRef.current = index;
    setOpenedPack(undefined);
  });

  useEffect(() => {
    if (openedSet || pendingSetIndexRef.current === undefined) return;

    selectStickerSet(pendingSetIndexRef.current);
    pendingSetIndexRef.current = undefined;
  }, [openedSet, selectStickerSet]);

  const handleTrendingDismiss = useLastCallback(() => {
    const el = trendingRef.current;
    if (!el) {
      hideTrendingStickers();
      return;
    }

    requestForcedReflow(() => {
      const height = el.scrollHeight;

      return () => {
        setExtraStyles(el, { height: `${height}px`, overflow: 'hidden' });

        requestForcedReflow(() => {
          void el.offsetHeight;

          return () => {
            setExtraStyles(el, {
              height: '0px',
              marginBottom: '0',
              opacity: '0',
              transition: `height ${TRENDING_DISMISS_DURATION}ms ease-in-out, `
                + `opacity ${TRENDING_DISMISS_DURATION}ms ease-in-out, `
                + `margin-bottom ${TRENDING_DISMISS_DURATION}ms ease-in-out`,
            });

            waitForTransitionEnd(el, () => {
              hideTrendingStickers();
            }, 'height', TRENDING_DISMISS_FALLBACK_MS);
          };
        });
      };
    });
  });

  const handleLocalSectionToggle = useLastCallback(() => {
    setIsLocalSectionCollapsed(!isLocalSectionCollapsed);
  });

  const handleQueryChange = useLastCallback((value: string) => {
    setOpenedPack(undefined);
    setQuery(value);
  });

  if (chatId && !chat) return undefined;

  function renderCover(stickerSet: StickerSetOrReactionsSetOrRecent, index: number) {
    const firstSticker = stickerSet.stickers?.[0];
    const buttonClassName = buildClassName(styles.stickerCover, index === activeSetIndex && styles.activated);

    if (stickerSet.id === RECENT_SYMBOL_SET_ID || stickerSet.hasThumbnail || !firstSticker) {
      return (
        <Button
          key={stickerSet.id}
          className={buttonClassName}
          ariaLabel={stickerSet.title}
          round
          faded={stickerSet.id === RECENT_SYMBOL_SET_ID}
          color="translucent"

          onClick={() => handleCoverClick(index)}
        >
          {stickerSet.id === RECENT_SYMBOL_SET_ID ? (
            <Icon name="clock" />
          ) : (
            <StickerSetCover
              stickerSet={stickerSet as ApiStickerSet}
              noPlay={!canAnimate || !loadAndPlay}
              observeIntersection={observeIntersectionForCovers}
              forcePlayback
            />
          )}
        </Button>
      );
    } else {
      return (
        <StickerButton
          key={stickerSet.id}
          sticker={firstSticker}
          size={STICKER_SIZE_PICKER_HEADER}
          title={stickerSet.title}
          className={buildClassName(buttonClassName, styles.stickerCoverSticker)}
          noPlay={!canAnimate || !loadAndPlay}
          observeIntersection={observeIntersectionForCovers}
          noContextMenu
          withTranslucentThumb={isTranslucent}
          onClick={handleCoverClick}
          clickArg={index}
          forcePlayback
        />
      );
    }
  }

  function renderFoundPack(set: ApiStickerSet, index: number) {
    const firstSticker = set.covers?.[0] || set.stickers?.[0];

    return (
      <Button
        key={set.id}
        className={styles.foundPack}
        color="translucent"
        ariaLabel={set.title}

        onClick={() => handleFoundPackClick(set)}
      >
        {set.hasThumbnail || !firstSticker ? (
          <StickerSetCover
            stickerSet={set}
            size={FOUND_PACK_COVER_SIZE}
            noPlay={!canAnimate || !loadAndPlay}
            observeIntersection={observeIntersectionForResults}
            forcePlayback
          />
        ) : (
          <StickerButton
            sticker={firstSticker}
            size={FOUND_PACK_COVER_SIZE}
            className={styles.foundPackCover}
            noPlay={!canAnimate || !loadAndPlay}
            observeIntersection={observeIntersectionForResults}
            noContextMenu
            withTranslucentThumb={isTranslucent}
            clickArg={index}
            forcePlayback
          />
        )}
        <span className={styles.foundPackTitle}>{set.title}</span>
      </Button>
    );
  }

  function renderTrendingPack(set: ApiStickerSet) {
    const firstSticker = set.covers?.[0] || set.stickers?.[0];

    return (
      <Button
        key={set.id}
        className={styles.trendingPack}
        color="translucent"
        ariaLabel={set.title}

        onClick={() => handleFoundPackClick(set)}
      >
        {set.hasThumbnail || !firstSticker ? (
          <StickerSetCover
            stickerSet={set}
            size={TRENDING_COVER_SIZE}
            noPlay={!canAnimate || !loadAndPlay}
            observeIntersection={observeIntersectionForResults}
            forcePlayback
          />
        ) : (
          <StickerButton
            sticker={firstSticker}
            size={TRENDING_COVER_SIZE}
            className={styles.trendingPackCover}
            noPlay={!canAnimate || !loadAndPlay}
            observeIntersection={observeIntersectionForResults}
            noContextMenu
            withTranslucentThumb={isTranslucent}
            clickArg={undefined}
            forcePlayback
          />
        )}
      </Button>
    );
  }

  function renderTrending() {
    return (
      <div ref={trendingRef} className="symbol-set">
        <div className="symbol-set-header">
          <p className="symbol-set-title">
            <span className="symbol-set-name">
              {lang('StickersArtistSeries')}
            </span>
          </p>
          <Button
            className={styles.trendingClose}
            round
            size="tiny"
            color="translucent"
            ariaLabel={lang('AccDescrCloseTrendingStickers')}

            onClick={handleTrendingDismiss}
          >
            <Icon name="close" />
          </Button>
        </div>
        <TrendingPacksRow>
          {trendingSets!.map(renderTrendingPack)}
        </TrendingPacksRow>
      </div>
    );
  }

  function renderResultStickers(stickers: ApiSticker[]) {
    return stickers.map((sticker) => (
      <StickerButton
        key={sticker.id}
        sticker={sticker}
        size={STICKER_SIZE_PICKER}
        observeIntersection={observeIntersectionForResults}
        noPlay={!canAnimate || !loadAndPlay}
        noContextMenu={noContextMenus}
        withTranslucentThumb={isTranslucent}
        onClick={canSendStickers ? handleStickerSelect : undefined}
        clickArg={sticker}
        forcePlayback
      />
    ));
  }

  function renderResultSection(
    title: string, stickers: ApiSticker[], isCollapsed: boolean, onToggle: NoneToVoidFunction,
  ) {
    return (
      <CollapsibleSection
        className={styles.resultSection}
        title={title}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
      >
        <div className={styles.resultGrid}>
          {renderResultStickers(stickers)}
        </div>
      </CollapsibleSection>
    );
  }

  function renderOpenedPack() {
    return (
      <InlineStickerSetView
        stickerSet={openedSet!}
        stickerSize={STICKER_SIZE_PICKER}
        observeIntersection={observeIntersectionForResults}
        noPlay={!canAnimate || !loadAndPlay}
        noContextMenus={noContextMenus}
        isSavedMessages={isSavedMessages}
        isTranslucent={isTranslucent}
        onStickerSelect={canSendStickers ? handleStickerSelect : undefined}
      />
    );
  }

  function renderSearchResults() {
    if (!foundPackSets?.length && !customResults?.length) {
      return <div className={styles.pickerDisabled}>{lang('NoStickersFound')}</div>;
    }

    return (
      <div>
        {Boolean(foundPackSets?.length) && (
          <FoundPacksRow>
            {foundPackSets.map(renderFoundPack)}
          </FoundPacksRow>
        )}
        {Boolean(customResults?.length) && renderResultSection(
          lang('StickerSearchResult'), customResults, isLocalSectionCollapsed, handleLocalSectionToggle,
        )}
      </div>
    );
  }

  const fullClassName = buildClassName(styles.root, className);
  const headerClassName = buildClassName(
    styles.header,
    'no-scrollbar',
    !shouldHideTopBorder && styles.headerWithBorder,
  );

  const isLoading = !shouldRenderContents && canSendStickers;

  return (
    <Transition className={fullClassName} activeKey={isLoading ? 0 : 1} name="fade" shouldCleanup>
      {!shouldRenderContents ? (
        !canSendStickers ? (
          <div className={styles.pickerDisabled}>{lang('ErrorSendRestrictedStickersAll')}</div>
        ) : noPopulatedSets ? (
          <div className={styles.pickerDisabled}>{lang('NoStickers')}</div>
        ) : (
          <Loading />
        )
      ) : (
        <div
          className={buildClassName(
            styles.inner,
            styles.withSearch,
            isSearchActive && styles.searchActive,
          )}
        >
          <div ref={headerRef} className={headerClassName}>
            <div className="shared-canvas-container">
              <SharedCanvas>
                {allSets.slice(0, STICKER_PICKER_MAX_SHARED_COVERS).map(renderCover)}
              </SharedCanvas>
              {allSets.slice(STICKER_PICKER_MAX_SHARED_COVERS)
                .map((stickerSet, i) => renderCover(stickerSet, i + STICKER_PICKER_MAX_SHARED_COVERS))}
            </div>
          </div>
          <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onScroll={handleContentScroll}
            className={
              buildClassName(
                styles.main,
                IS_TOUCH_ENV ? 'no-scrollbar' : 'custom-scroll',
                styles.mainWithSearch,
              )
            }
          >
            <EmojiSearch
              value={query}
              placeholder={lang('SearchStickers')}
              isLoading={isOpenedSetLoading}
              hasBackButton={Boolean(openedSet)}
              className={styles.search}
              onChange={handleQueryChange}
              onGroupSelect={handlePackBackClick}
              onBackClick={handlePackBackClick}
              onFocus={markSearchFocused}
              onBlur={unmarkSearchFocused}
            />
            <Transition
              name="fade"
              activeKey={contentActiveKey}
              className={styles.contentTransition}
              shouldCleanup
            >
              {openedSet ? renderOpenedPack() : isShowingSearchResults ? renderSearchResults() : (
                <div>
                  {trendingSets && renderTrending()}
                  {noPopulatedSets && (
                    <div className={styles.pickerDisabled}>{lang('NoStickers')}</div>
                  )}
                  {allSets.map((stickerSet, i) => (
                    <StickerSet
                      key={stickerSet.id}
                      stickerSet={stickerSet}
                      loadAndPlay={Boolean(canAnimate && loadAndPlay)}
                      noContextMenus={noContextMenus}
                      index={i}
                      idPrefix={prefix}
                      observeIntersection={observeIntersectionForSet}
                      observeIntersectionForPlayingItems={observeIntersectionForPlayingItems}
                      observeIntersectionForShowingItems={observeIntersectionForShowingItems}
                      isNearActive={i >= activeSetIndex - 1 && i <= lastVisibleSetIndex + 1}
                      isSavedMessages={isSavedMessages}
                      isTranslucent={isTranslucent}
                      withInstantThumbs={withInstantThumbs}
                      onStickerSelect={handleStickerSelect}
                      onStickerRemoveRecent={handleRemoveRecentSticker}
                      forcePlayback
                    />
                  ))}
                </div>
              )}
            </Transition>
          </div>
          {openedSet && <StickerSetToggleButton stickerSet={openedSet} />}
        </div>
      )}
    </Transition>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const {
      setsById,
      added,
      recent,
      featured,
    } = global.stickers;

    const isSavedMessages = chatId ? selectIsChatWithSelf(global, chatId) : undefined;
    const chat = chatId ? selectChat(global, chatId) : undefined;

    const language = selectLanguageCode(global);
    const baseEmojiKeywords = global.emojiKeywords[BASE_EMOJI_KEYWORD_LANG];
    const emojiKeywords = language !== BASE_EMOJI_KEYWORD_LANG ? global.emojiKeywords[language] : undefined;

    return {
      chat,
      recentStickers: recent.stickers,
      stickerSetsById: setsById,
      addedSetIds: added.setIds,
      featuredIds: featured.setIds,
      hiddenTrendingSetId: featured.hiddenSetId,
      canAnimate: selectShouldLoopStickers(global),
      isSavedMessages,
      baseEmojiKeywords: baseEmojiKeywords?.keywords,
      emojiKeywords: emojiKeywords?.keywords,
    };
  },
)(StickerPicker));
