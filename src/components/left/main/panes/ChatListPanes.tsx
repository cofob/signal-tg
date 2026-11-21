import {
  memo, useLayoutEffect, useRef, useSignal, useUnmountCleanup,
} from '@teact';
import { addExtraClass } from '@teact/teact-dom';
import { withGlobal } from '../../../../global';

import type { ApiPromoData } from '../../../../api/types';

import { selectIsCurrentUserFrozen, selectIsForumPanelOpen } from '../../../../global/selectors';
import buildClassName from '../../../../util/buildClassName';
import { REM } from '../../../common/helpers/mediaDimensions';

import useAppLayout from '../../../../hooks/useAppLayout';
import useCacheBusterRef from '../../../../hooks/useCacheBusterRef';
import { useSignalEffect } from '../../../../hooks/useSignalEffect';
import {
  applyAnimationState, commitInMutatePhase, type PaneState, transitionIslandVisual,
} from '../../../middle/hooks/useHeaderPane';

import AudioPlayer from '../../../middle/panes/AudioPlayer';
import FrozenAccountPane from './FrozenAccountPane';
import SuggestionPane from './SuggestionPane';

import styles from './ChatListPanes.module.scss';

type OwnProps = {
  className?: string;
  noBanners?: boolean;
  onHeightChange: (height: number) => void;
};

type StateProps = {
  promoData?: ApiPromoData;
  isAccountFrozen?: boolean;
  isForumPanelOpen?: boolean;
};

const BOTTOM_MARGIN = 0.5 * REM;
const FALLBACK_PANE_STATE = { height: 0 };

const ChatListPanes = ({
  className,
  noBanners,
  promoData,
  isAccountFrozen,
  isForumPanelOpen,
  onHeightChange,
}: OwnProps & StateProps) => {
  const [getPlayerState, setPlayerState] = useSignal<PaneState>(FALLBACK_PANE_STATE);
  const [getFrozenAccountState, setFrozenAccountState] = useSignal<PaneState>(FALLBACK_PANE_STATE);
  const [getSuggestionState, setSuggestionState] = useSignal<PaneState>(FALLBACK_PANE_STATE);

  const ref = useRef<HTMLDivElement>();
  const [visualTokenRef, invalidateVisualToken] = useCacheBusterRef();
  const suppressRowAnimationsUntilRef = useRef(0);

  const { isMobile, isTablet } = useAppLayout();

  useLayoutEffect(() => {
    if (ref.current) addExtraClass(ref.current, styles.rootHidden);
  }, []);

  // Cancel any in-flight deferred writes when the component unmounts
  useUnmountCleanup(invalidateVisualToken);

  const canShowSuggestions = !isAccountFrozen && !isForumPanelOpen && promoData;

  useSignalEffect(() => {
    // Keep in sync with the order of the panes in the DOM
    const stateArray = [
      getPlayerState(),
      getFrozenAccountState(),
      getSuggestionState(),
    ];

    const totalHeight = stateArray.reduce((acc, state) => acc + state.height, 0);

    onHeightChange(totalHeight ? totalHeight + BOTTOM_MARGIN : 0);

    const container = ref.current;
    const writeToken = ++visualTokenRef.current;
    commitInMutatePhase(() => {
      if (visualTokenRef.current !== writeToken) return;
      if (totalHeight > 0) {
        const isIslandHidden = Boolean(container?.classList.contains(styles.rootHidden));
        const noTransition = isIslandHidden || performance.now() < suppressRowAnimationsUntilRef.current;
        applyAnimationState({ list: stateArray, noTransition, gapPx: 0 });
      }
      if (container) {
        transitionIslandVisual({
          container,
          toHeight: totalHeight,
          shouldGlide: true,
          hiddenClassName: styles.rootHidden,
          suppressRowAnimationsUntilRef,
          isCanceled: () => visualTokenRef.current !== writeToken,
        });
      }
    });
  }, [
    getPlayerState, getFrozenAccountState, getSuggestionState,
  ]);

  return (
    <div
      ref={ref}
      className={
        buildClassName(
          'ChatListPanes',
          styles.root,
          className,
        )
      }
    >
      {(isMobile || isTablet) && (
        <AudioPlayer
          className={styles.panePlayer}
          isCompact
          onPaneStateChange={setPlayerState}
        />
      )}
      {!noBanners && (
        <>
          <FrozenAccountPane
            isAccountFrozen={isAccountFrozen}
            onPaneStateChange={setFrozenAccountState}
          />
          <SuggestionPane
            promoData={canShowSuggestions ? promoData : undefined}
            onPaneStateChange={setSuggestionState}
          />
        </>
      )}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    return {
      isForumPanelOpen: selectIsForumPanelOpen(global),
      promoData: global.promoData,
      isAccountFrozen: selectIsCurrentUserFrozen(global),
    };
  },
)(ChatListPanes));
