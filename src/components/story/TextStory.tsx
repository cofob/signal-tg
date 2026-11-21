import { memo } from '../../lib/teact/teact';

import type { ApiTextStory } from '../../api/types';

import buildClassName from '../../util/buildClassName';
import renderText from '../common/helpers/renderText';

import styles from './TextStory.module.scss';

type OwnProps = {
  textStory: ApiTextStory;
  className?: string;
};

// Signal Desktop `getTextSize` in `ts/components/TextAttachment.dom.tsx`: shorter texts are larger
const CHAR_LIMIT_TEXT_LARGE = 50;
const CHAR_LIMIT_TEXT_MEDIUM = 200;

const STYLE_CLASS_NAMES: Record<ApiTextStory['style'], string> = {
  default: styles.styleDefault,
  regular: styles.styleDefault,
  bold: styles.styleBold,
  serif: styles.styleSerif,
  script: styles.styleScript,
  condensed: styles.styleCondensed,
};

/** A Signal text story: the text centered on its background, with the font of its style and a link preview */
const TextStory = ({ textStory, className }: OwnProps) => {
  const {
    text = '', style, textColor, textBackgroundColor, background, linkPreview,
  } = textStory;

  return (
    <div className={buildClassName(styles.root, className)} style={`background: ${background}`}>
      {text && (
        <div
          className={buildClassName(styles.text, STYLE_CLASS_NAMES[style], getTextSizeClassName(text))}
          style={`color: ${textColor};${textBackgroundColor ? ` background-color: ${textBackgroundColor};` : ''}`}
          dir="auto"
        >
          {renderText(text, ['emoji', 'br'])}
        </div>
      )}
      {linkPreview && (
        <div className={styles.linkPreview}>
          {linkPreview.title && <div className={styles.linkTitle}>{renderText(linkPreview.title)}</div>}
          <div className={styles.linkUrl}>{linkPreview.url}</div>
        </div>
      )}
    </div>
  );
};

export function getTextSizeClassName(text: string) {
  if (text.length < CHAR_LIMIT_TEXT_LARGE) return styles.large;
  if (text.length < CHAR_LIMIT_TEXT_MEDIUM) return styles.medium;
  return styles.small;
}

export function getTextStyleClassName(style: ApiTextStory['style']) {
  return STYLE_CLASS_NAMES[style];
}

export default memo(TextStory);
