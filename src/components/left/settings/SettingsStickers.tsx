import {
  memo, useCallback, useMemo, useRef,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type {
  ApiSticker,
  ApiStickerSet,
} from '../../../api/types';
import type { AccountSettings } from '../../../types';
import { SettingsScreens } from '../../../types';

import { selectCanPlayAnimatedEmojis } from '../../../global/selectors';
import { pick } from '../../../util/iteratees';

import useHistoryBack from '../../../hooks/useHistoryBack';
import { useIntersectionObserver } from '../../../hooks/useIntersectionObserver';
import useLang from '../../../hooks/useLang';

import StickerSetCard from '../../common/StickerSetCard';
import Island, { IslandDescription, IslandTitle } from '../../gili/layout/Island';
import Checkbox from '../../ui/Checkbox';
import ListItem from '../../ui/ListItem';

type OwnProps = {
  isActive?: boolean;
  onReset: () => void;
};

type StateProps =
  Pick<AccountSettings, (
    'shouldSuggestStickers' | 'shouldUpdateStickerSetOrder'
  )> & {
    addedSetIds?: string[];
    customEmojiSetIds?: string[];
    stickerSetsById: Record<string, ApiStickerSet>;
    canPlayAnimatedEmojis: boolean;
  };

const SettingsStickers = ({
  isActive,
  addedSetIds,
  customEmojiSetIds,
  stickerSetsById,
  shouldSuggestStickers,
  shouldUpdateStickerSetOrder,
  canPlayAnimatedEmojis,
  onReset,
}: OwnProps & StateProps) => {
  const {
    setSettingOption,
    openStickerSet,
    openSettingsScreen,
  } = getActions();
  const lang = useLang();

  const stickerSettingsRef = useRef<HTMLDivElement>();
  const { observe: observeIntersectionForCovers } = useIntersectionObserver({ rootRef: stickerSettingsRef });

  const handleStickerSetClick = useCallback((sticker: ApiSticker) => {
    openStickerSet({
      stickerSetInfo: sticker.stickerSetInfo,
    });
  }, [openStickerSet]);

  const handleSuggestStickerSetOrderChange = useCallback((newValue: boolean) => {
    setSettingOption({ shouldUpdateStickerSetOrder: newValue });
  }, [setSettingOption]);

  const handleSuggestStickersChange = useCallback((newValue: boolean) => {
    setSettingOption({ shouldSuggestStickers: newValue });
  }, [setSettingOption]);

  const stickerSets = useMemo(() => (
    addedSetIds && Object.values(pick(stickerSetsById, addedSetIds))
  ), [addedSetIds, stickerSetsById]);

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  return (
    <div className="settings-content custom-scroll">
      <Island>
        <Checkbox
          label={lang('SuggestStickers')}
          checked={shouldSuggestStickers}
          onCheck={handleSuggestStickersChange}
        />
        <ListItem
          narrow
          onClick={() => openSettingsScreen({ screen: SettingsScreens.CustomEmoji })}
          icon="smile"
        >
          {lang('StickersListEmojiItem')}
          {customEmojiSetIds && <span className="settings-item__current-value">{customEmojiSetIds.length}</span>}
        </ListItem>
      </Island>

      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>
        {lang('InstalledStickersDynamicPackOrder')}
      </IslandTitle>
      <Island>
        <Checkbox
          label={lang('InstalledStickersDynamicPackOrder')}
          checked={shouldUpdateStickerSetOrder}
          onCheck={handleSuggestStickerSetOrderChange}
        />
      </Island>
      <IslandDescription dir="auto">
        {lang('InstalledStickersDynamicPackOrderInfo')}
      </IslandDescription>

      {stickerSets && (
        <>
          <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>
            {lang('ChooseStickerMyStickerSets')}
          </IslandTitle>
          <Island>
            <div ref={stickerSettingsRef}>
              {stickerSets.map((stickerSet: ApiStickerSet) => (
                <StickerSetCard
                  key={stickerSet.id}
                  stickerSet={stickerSet}
                  observeIntersection={observeIntersectionForCovers}
                  onClick={handleStickerSetClick}
                  noPlay={!canPlayAnimatedEmojis}
                />
              ))}
            </div>
          </Island>
        </>
      )}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    return {
      ...pick(global.settings.byKey, [
        'shouldSuggestStickers',
        'shouldUpdateStickerSetOrder',
      ]),
      addedSetIds: global.stickers.added.setIds,
      customEmojiSetIds: global.customEmojis.added.setIds,
      stickerSetsById: global.stickers.setsById,
      canPlayAnimatedEmojis: selectCanPlayAnimatedEmojis(global),
    };
  },
)(SettingsStickers));
