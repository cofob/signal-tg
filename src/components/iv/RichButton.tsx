import { memo } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { ApiRichButton } from '../../api/types';
import type { IconName } from '../../types/icons';
import type { RichTextProps } from './RichText';

import { canAuthorButton } from '../../global/helpers/buttons';
import buildClassName from '../../util/buildClassName';
import { hasSharedCanvasContent } from '../../util/text/richText';

import { useSharedCanvas } from '../../hooks/useCoordsInSharedCanvas';
import useLastCallback from '../../hooks/useLastCallback';

import Icon from '../common/icons/Icon';
import SharedCanvas from '../common/SharedCanvas';
import RichText from './RichText';

import styles from './RichContent.module.scss';

type OwnProps = {
  button: ApiRichButton;
  isInline?: boolean;
} & Omit<RichTextProps, 'text'>;

export const RICH_BUTTON_ICONS: Partial<Record<ApiRichButton['action']['type'], IconName>> = {
  url: 'arrow-right',
  copy: 'copy',
  userProfile: 'user-filled',
};

const RichButton = ({
  button, isInline, ...context
}: OwnProps) => {
  const { clickRichButton } = getActions();
  const { chatId, messageId, threadId } = context;
  const { text } = button;
  const isLink = isInline && button.action.type === 'callback' && button.style?.isLink;
  const icon = !isInline && RICH_BUTTON_ICONS[button.action.type];
  const isDisabled = button.action.type === 'disabled' || !canAuthorButton(button.action);

  const handleClick = useLastCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    clickRichButton({
      chatId, messageId, threadId, action: button.action,
    });
  });

  const handleMouseDown = useLastCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  });

  const sharedCanvas = useSharedCanvas();
  const withNestedCanvas = sharedCanvas && hasSharedCanvasContent(text);

  return (
    <button
      type="button"
      className={buildClassName(
        styles.richButton,
        icon && styles.hasButtonIcon,
        isInline && styles.inlineRichButton,
        button.style?.type && styles[`${button.style.type}Button`],
        isLink && styles.linkButton,
      )}
      disabled={isDisabled}
      data-rich-button={JSON.stringify({
        action: button.action.type === 'callback' ? { type: 'disabled' } : button.action,
        style: button.style,
      })}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
    >
      <span className={buildClassName(styles.buttonLabel, withNestedCanvas && 'shared-canvas-container')}>
        {withNestedCanvas ? (
          <SharedCanvas isGpu={sharedCanvas.isGpu} contentKey={text}>
            <RichText text={text} {...context} isButtonLabel />
          </SharedCanvas>
        ) : (
          <RichText text={text} {...context} isButtonLabel />
        )}
      </span>
      {icon && (
        <Icon
          name={icon}
          className={buildClassName(styles.buttonIcon, icon === 'arrow-right' && styles.externalButtonIcon)}
        />
      )}
    </button>
  );
};

export default memo(RichButton);
