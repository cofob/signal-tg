import type { TeactNode } from '../../../lib/teact/teact';

import type { TextPart } from '../../../types';

import { RE_LINK_TEMPLATE, RE_MENTION_TEMPLATE } from '../../../config';
import { IS_EMOJI_SUPPORTED } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';
import { isDeepLink } from '../../../util/deepLinkParser';
import {
  handleEmojiLoad,
  LOADED_EMOJIS,
} from '../../../util/emoji/emoji';
import splitEmoji from '../../../util/emoji/splitEmoji';
import { compact } from '../../../util/iteratees';
import { getSgnlLinkStart, isSignalRoute } from '../../../util/signalLinks';
import { trimLinkEnd } from '../../../util/trimLinkEnd';

import MentionLink from '../../middle/message/MentionLink';
import SafeLink from '../SafeLink';

export type TextFilter = (
  'escape_html' | 'hq_emoji' | 'emoji' | 'emoji_html' | 'br' | 'br_html' | 'links' |
  'simple_markdown' | 'simple_markdown_html' | 'app_links'
);

const SIMPLE_MARKDOWN_REGEX = /(\*\*|__).+?\1/g;
const LINE_BREAK_REGEX = /\r\n|\r|\n/g;

export default function renderText(
  part: TextPart,
  filters: Array<TextFilter> = ['emoji'],
  params?: {
    markdownPostProcessor?: (part: string) => TeactNode;
  },
): TeactNode[] {
  if (typeof part !== 'string') {
    return [part];
  }

  return compact(filters.reduce((text, filter) => {
    switch (filter) {
      case 'escape_html':
        return escapeHtml(text, params?.markdownPostProcessor);

      case 'hq_emoji':
        return replaceEmojis(text, 'big', 'jsx', params?.markdownPostProcessor);

      case 'emoji':
        return replaceEmojis(text, 'small', 'jsx', params?.markdownPostProcessor);

      case 'emoji_html':
        return replaceEmojis(text, 'small', 'html');

      case 'br':
        return addLineBreaks(text, 'jsx', params?.markdownPostProcessor);

      case 'br_html':
        return addLineBreaks(text, 'html');

      case 'links':
        return addLinks(text, undefined, params?.markdownPostProcessor);

      // Only the links that the app opens itself: its `tg:` links and Signal's links
      case 'app_links':
        return addLinks(text, true, params?.markdownPostProcessor);

      case 'simple_markdown':
        return replaceSimpleMarkdown(text, 'jsx', params?.markdownPostProcessor);

      case 'simple_markdown_html':
        return replaceSimpleMarkdown(text, 'html');
    }

    return text;
  }, [part] as TextPart[]));
}

function escapeHtml(textParts: TextPart[], postProcessor?: (part: string) => TeactNode): TextPart[] {
  const postProcess = postProcessor || ((part: string) => part);

  const divEl = document.createElement('div');
  return textParts.reduce((result: TextPart[], part) => {
    if (typeof part !== 'string') {
      result.push(part);
      return result;
    }

    divEl.innerText = part;
    result.push(postProcess(divEl.innerHTML));

    return result;
  }, []);
}

function replaceEmojis(
  textParts: TextPart[], size: 'big' | 'small', type: 'jsx' | 'html',
  postProcessor?: (part: string) => TeactNode,
): TextPart[] {
  const postProcess = postProcessor || ((part: string) => part);

  if (IS_EMOJI_SUPPORTED) {
    return textParts.map((part) => typeof part === 'string' ? postProcess(part) : part);
  }

  return textParts.reduce((result: TextPart[], part: TextPart) => {
    if (typeof part !== 'string') {
      result.push(part);
      return result;
    }

    const className = buildClassName(
      'emoji',
      size === 'small' && 'emoji-small',
    );

    splitEmoji(part, size).forEach((emojiPart) => {
      if (typeof emojiPart === 'string') {
        result.push(postProcess(emojiPart));
        return;
      }

      const { src, text: sourceEmoji } = emojiPart;
      if (type === 'jsx') {
        const isLoaded = LOADED_EMOJIS.has(src);

        result.push(
          <img
            src={src}
            className={`${className}${!isLoaded ? ' opacity-transition slow shown' : ''}`}
            alt={sourceEmoji}
            data-path={src}
            draggable={false}
            onLoad={!isLoaded ? handleEmojiLoad : undefined}
          />,
        );
      }
      if (type === 'html') {
        result.push(
          `<img\
          draggable="false"\
          class="${className}"\
          src="${src}"\
          alt="${sourceEmoji}"\
        />`,
        );
      }
    });

    return result;
  }, [] as TextPart[]);
}

function addLineBreaks(
  textParts: TextPart[], type: 'jsx' | 'html', postProcessor?: (part: string) => TeactNode,
): TextPart[] {
  const postProcess = postProcessor || ((part: string) => part);

  return textParts.reduce((result: TextPart[], part) => {
    if (typeof part !== 'string') {
      result.push(part);
      return result;
    }

    const lineBreaks = part.match(LINE_BREAK_REGEX);
    const splittenParts = part
      .split(LINE_BREAK_REGEX)
      .reduce((parts: TextPart[], line: string, i, source) => {
        // This adds non-breaking space if line was indented with spaces, to preserve the indentation
        const trimmedLine = line.trimStart();
        const indentLength = line.length - trimmedLine.length;
        parts.push(String.fromCharCode(160).repeat(indentLength));
        parts.push(postProcess(trimmedLine));

        if (i !== source.length - 1) {
          parts.push(
            type === 'jsx' ? <br data-text-content={lineBreaks![i]} /> : '<br />',
          );
        }

        return parts;
      }, []);

    return [...result, ...splittenParts];
  }, []);
}

const RE_LINK = new RegExp(`${RE_LINK_TEMPLATE}|${RE_MENTION_TEMPLATE}`, 'ig');

function addLinks(
  textParts: TextPart[], allowOnlyAppLinks?: boolean, postProcessor?: (part: string) => TeactNode,
): TextPart[] {
  const postProcess = postProcessor || ((part: string) => part);

  return textParts.reduce<TextPart[]>((result, part) => {
    if (typeof part !== 'string') {
      result.push(part);
      return result;
    }

    const links = part.match(RE_LINK);
    if (!links || !links.length) {
      result.push(postProcess(part));
      return result;
    }

    const content: TextPart[] = [];

    let nextLink = links.shift();
    let lastIndex = 0;
    while (nextLink) {
      const index = part.indexOf(nextLink, lastIndex);
      if (nextLink.startsWith('@')) {
        content.push(postProcess(part.substring(lastIndex, index)));
        content.push(
          <MentionLink username={nextLink}>
            {postProcess(nextLink)}
          </MentionLink>,
        );
        lastIndex = index + nextLink.length;
      } else {
        const linkEnd = index + trimLinkEnd(nextLink).length;
        // The pattern leaves out the `sgnl://` before a Signal link
        const linkStart = Math.max(getSgnlLinkStart(part, index, part.substring(index, linkEnd)), lastIndex);
        const link = part.substring(linkStart, linkEnd);

        content.push(postProcess(part.substring(lastIndex, linkStart)));
        if (!allowOnlyAppLinks || isDeepLink(link) || isSignalRoute(link)) {
          content.push(
            <SafeLink text={link} url={link} />,
          );
        } else {
          content.push(postProcess(link));
        }
        lastIndex = linkEnd;
      }
      nextLink = links.shift();
    }
    content.push(postProcess(part.substring(lastIndex)));

    return [...result, ...content];
  }, []);
}

function replaceSimpleMarkdown(
  textParts: TextPart[], type: 'jsx' | 'html', postProcessor?: (part: string) => TeactNode,
): TextPart[] {
  // Currently supported only for JSX. If needed, add typings to support HTML as well.
  const postProcess = postProcessor || ((part: string) => part);

  return textParts.reduce<TextPart[]>((result, part) => {
    if (typeof part !== 'string') {
      result.push(part);
      return result;
    }

    const parts = part.split(SIMPLE_MARKDOWN_REGEX);
    const entities: string[] = part.match(SIMPLE_MARKDOWN_REGEX) || [];
    result.push(postProcess(parts[0]));

    return entities.reduce((entityResult: TextPart[], entity, i) => {
      if (type === 'jsx') {
        entityResult.push(
          entity.startsWith('**')
            ? <b>{postProcess(entity.replace(/\*\*/g, ''))}</b>
            : <i>{postProcess(entity.replace(/__/g, ''))}</i>,
        );
      } else {
        entityResult.push(
          entity.startsWith('**')
            ? `<b>${entity.replace(/\*\*/g, '')}</b>`
            : `<i>${entity.replace(/__/g, '')}</i>`,
        );
      }

      const index = i * 2 + 2;
      if (parts[index]) {
        entityResult.push(postProcess(parts[index]));
      }

      return entityResult;
    }, result);
  }, []);
}

export function areLinesWrapping(text: string, element: HTMLElement) {
  const lines = (text.trim().match(/\n/g) || '').length + 1;
  const { lineHeight } = getComputedStyle(element);
  const lineHeightParsed = parseFloat(lineHeight.split('px')[0]);

  return element.clientHeight >= (lines + 1) * lineHeightParsed;
}
