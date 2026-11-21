import type { TeactNode } from '../../../lib/teact/teact';
import { memo, useMemo } from '../../../lib/teact/teact';

import type { ApiKeyboardButton } from '../../../api/types';

import buildClassName from '../../../util/buildClassName';
import renderText from '../../common/helpers/renderText';

import CustomEmoji from '../../common/CustomEmoji';
import Button from '../../ui/Button';

import styles from './InlineButtons.module.scss';

type OwnProps = {
  className?: string;
  inlineButtons: ApiKeyboardButton[][];
  onClick: (payload: ApiKeyboardButton) => void;
};

const ICON_SIZE = 16;

const InlineButtons = ({ className, inlineButtons, onClick }: OwnProps) => {
  const buttonTexts = useMemo(() => {
    const texts: TeactNode[][] = [];
    inlineButtons.forEach((row) => {
      texts.push(row.map((button) => renderText(button.text)));
    });
    return texts;
  }, [inlineButtons]);

  return (
    <div className={buildClassName(styles.root, className)}>
      {inlineButtons.map((row, i) => (
        <div className={styles.row}>
          {row.map((button, j) => (
            <Button
              className={buildClassName(
                styles.button, button.style?.type && styles[`${button.style.type}Tint`],
              )}
              size="tiny"
              ripple
              noForcedUpperCase
              onClick={() => onClick(button)}
            >
              <span className={styles.inlineButtonText}>
                {button.style?.iconId && (
                  <CustomEmoji
                    className={styles.customEmojiIcon}
                    documentId={button.style.iconId}
                    size={ICON_SIZE}
                  />
                )}
                {buttonTexts[i][j]}
              </span>
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
};

export default memo(InlineButtons);
