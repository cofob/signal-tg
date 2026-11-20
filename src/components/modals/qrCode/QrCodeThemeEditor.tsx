import type { ElementRef } from '../../../lib/teact/teact';
import { memo, useMemo } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type {
  ApiAvailableReaction,
  ApiReaction,
  ApiReactionWithPaid,
  ApiShareThemeBackdrop,
  ApiSticker,
} from '../../../api/types';
import type { IconName } from '../../../types/icons';
import type { ShareThemeBackdropOption, ShareThemeDraft } from './helpers/shareTheme';

import { getReactionKey, isSameReaction } from '../../../global/helpers';
import { IS_TOUCH_ENV } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';
import {
  buildBackdropOptions,
  buildEmojiBackdropTheme,
  getShareThemeBackdrop,
  toggleEmojiPick,
} from './helpers/shareTheme';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import CustomEmoji from '../../common/CustomEmoji';
import CustomEmojiPicker from '../../common/CustomEmojiPicker';
import Icon from '../../common/icons/Icon';
import ReactionStaticEmoji from '../../common/reactions/ReactionStaticEmoji';

import styles from './QrCodeThemeEditor.module.scss';

export type QrThemePanel = 'colors' | 'emoji';

type OwnProps = {
  theme: ShareThemeDraft;
  activePanel?: QrThemePanel;
  panelRef: ElementRef<HTMLDivElement>;
  backdrops?: ApiShareThemeBackdrop[];
  availableReactions?: ApiAvailableReaction[];
  emojiPresets?: ApiSticker[];
  isCurrentUserPremium?: boolean;
  onPanelChange: (panel?: QrThemePanel) => void;
  onThemeChange: (theme: ShareThemeDraft) => void;
};

const PANELS: { key: QrThemePanel; icon: IconName; titleKey: 'QrCodeColors' | 'QrCodeEmoji' }[] = [
  { key: 'colors', icon: 'colorize', titleKey: 'QrCodeColors' },
  { key: 'emoji', icon: 'smile', titleKey: 'QrCodeEmoji' },
];

const NO_EMOJIS: ApiReaction[] = [];
const PICK_EMOJI_SIZE = 28;

const QrCodeThemeEditor = ({
  theme,
  activePanel,
  panelRef,
  backdrops,
  availableReactions,
  emojiPresets,
  isCurrentUserPremium,
  onPanelChange,
  onThemeChange,
}: OwnProps) => {
  const { showNotification } = getActions();

  const lang = useLang();

  const backdropOptions = useMemo(() => buildBackdropOptions(backdrops), [backdrops]);
  const emojis = theme?.type === 'emojiBackdrop' ? theme.emojis : NO_EMOJIS;
  const selectedBackdrop = getShareThemeBackdrop(theme, backdrops);
  const selectedReactionIds = useMemo(() => emojis.map(getReactionKey), [emojis]);
  const presetIds = useMemo(() => new Set(emojiPresets?.map(({ id }) => id)), [emojiPresets]);

  const handleBackdropClick = useLastCallback((option: ShareThemeBackdropOption) => {
    onThemeChange(buildEmojiBackdropTheme(option.backdropId, emojis));
  });

  const handleReactionSelect = useLastCallback((reaction: ApiReactionWithPaid) => {
    if (reaction.type === 'paid') return;

    const isPicked = emojis.some((emoji) => isSameReaction(emoji, reaction));
    if (!isPicked && !isCurrentUserPremium && getIsPremiumReaction(reaction, presetIds, availableReactions)) {
      showNotification({ message: { key: 'PremiumUnlockEmoji' } });
      return;
    }

    const backdropId = theme?.type === 'emojiBackdrop' ? theme.backdropId : undefined;
    onThemeChange(buildEmojiBackdropTheme(backdropId, toggleEmojiPick(emojis, reaction)));
  });

  const handleCustomEmojiSelect = useLastCallback((sticker: ApiSticker) => {
    handleReactionSelect({ type: 'custom', documentId: sticker.id });
  });

  function renderColors() {
    return (
      <div className={buildClassName(styles.swatches, IS_TOUCH_ENV ? 'no-scrollbar' : 'custom-scroll')}>
        {backdropOptions.map((option) => (
          <button
            key={option.backdropId ?? 'default'}
            type="button"
            className={buildClassName(styles.swatch, option === selectedBackdrop && styles.swatchSelected)}
            style={`--swatch-center: ${option.centerColor}; --swatch-edge: ${option.edgeColor}`}
            aria-label={option.name ?? lang('QrCodeDefaultColor')}
            onClick={() => handleBackdropClick(option)}
          />
        ))}
      </div>
    );
  }

  function renderEmoji() {
    return (
      <>
        <CustomEmojiPicker
          className={styles.emojiPicker}
          pickerListClassName={buildClassName(emojis.length && styles.emojiPickerList)}
          idPrefix="qr-code-emoji-"
          loadAndPlay
          isReactionPicker
          noAddButton
          topCustomEmojis={emojiPresets}
          selectedReactionIds={selectedReactionIds}
          withSelectionOrder
          onCustomEmojiSelect={handleCustomEmojiSelect}
          onReactionSelect={handleReactionSelect}
        />
        {Boolean(emojis.length) && (
          <div className={styles.picks}>
            {emojis.map((reaction) => (
              <button
                key={getReactionKey(reaction)}
                type="button"
                className={styles.pick}
                onClick={() => handleReactionSelect(reaction)}
              >
                {reaction.type === 'custom' ? (
                  <CustomEmoji documentId={reaction.documentId} size={PICK_EMOJI_SIZE} />
                ) : (
                  <ReactionStaticEmoji
                    reaction={reaction}
                    availableReactions={availableReactions}
                    size={PICK_EMOJI_SIZE}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className={styles.island} inert={Boolean(activePanel)}>
        {PANELS.map(({ key, icon, titleKey }) => (
          <button
            key={key}
            type="button"
            className={buildClassName(styles.islandButton, activePanel === key && styles.islandButtonActive)}
            onClick={() => onPanelChange(activePanel === key ? undefined : key)}
          >
            <Icon name={icon} className={styles.islandIcon} />
            {lang(titleKey)}
          </button>
        ))}
      </div>
      {activePanel && (
        <div ref={panelRef} className={styles.panel}>
          {activePanel === 'colors' && renderColors()}
          {activePanel === 'emoji' && renderEmoji()}
        </div>
      )}
    </>
  );
};

export default memo(QrCodeThemeEditor);

function getIsPremiumReaction(
  reaction: ApiReaction, presetIds: Set<string>, availableReactions?: ApiAvailableReaction[],
) {
  if (reaction.type === 'custom') return !presetIds.has(reaction.documentId);

  return Boolean(availableReactions?.find((available) => isSameReaction(available.reaction, reaction))?.isPremium);
}
