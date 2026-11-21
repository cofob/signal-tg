import { type TeactNode } from '../../../../lib/teact/teact';
import { getActions } from '../../../../global';

import type { ApiMessage } from '../../../../api/types';
import type {
  LangKey,
  LangPairPluralWithVariables,
  LangPairWithVariables,
  PluralLangKeyWithVariables,
  RegularLangKeyWithVariables,
} from '../../../../types/language';
import type { LangFn } from '../../../../util/localization';

import { getMessageContent } from '../../../../global/helpers';
import { IS_SAFARI } from '../../../../util/browser/windowEnvironment';
import buildClassName from '../../../../util/buildClassName';
import renderText from '../../../common/helpers/renderText';

import Link from '../../../ui/Link';

import styles from '../ActionMessage.module.scss';

type SuffixKey<T, K extends keyof T> = `${K & string}You` extends keyof T ? T[`${K & string}You`] : never;
type RemoveYouSuffix<K extends string> = K extends `${infer Key}You` ? Key : never;
type LangKeyWithYou = Extract<LangKey, RemoveYouSuffix<LangKey>>;
type VariablesForKey<K extends LangKeyWithYou> =
  K extends RegularLangKeyWithVariables
    ? LangPairWithVariables<TeactNode | undefined>[K] | SuffixKey<LangPairWithVariables, K>
    : K extends PluralLangKeyWithVariables
      ? LangPairPluralWithVariables<TeactNode | undefined>[K] | SuffixKey<LangPairPluralWithVariables, K>
      : undefined;

export function translateWithYou<K extends LangKeyWithYou>(
  lang: LangFn,
  key: K,
  isYou: boolean,
  variables: VariablesForKey<K>,
  options?: {
    pluralValue?: number;
    asText?: boolean;
    withMarkdown?: boolean;
    renderTextFilters?: string[];
  },
): TeactNode {
  const { pluralValue, asText, withMarkdown, renderTextFilters } = options || {};
  const translationKey = isYou ? (`${key}You` as LangKey) : key;

  return lang(
    // @ts-ignore -- I have no idea if this even possible to type correctly
    translationKey,
    variables,
    {
      withNodes: !asText, withMarkdown, pluralValue, renderTextFilters,
    },
  );
}

export function getPinnedMediaValue(lang: LangFn, message: ApiMessage) {
  const {
    audio, contact, document, storyData,
    photo, pollId, sticker, video, voice, dice,
  } = getMessageContent(message);

  if (message.groupedId) return lang('ActionPinnedMediaAlbum');
  if (photo) return lang('ActionPinnedMediaPhoto');
  if (audio) return lang('ActionPinnedMediaAudio');
  if (voice) return lang('ActionPinnedMediaVoice');
  if (video?.isRound) return lang('ActionPinnedMediaVideoMessage');
  if (video?.isGif) return lang('ActionPinnedMediaGif');
  if (video) return lang('ActionPinnedMediaVideo');
  if (sticker) return lang('ActionPinnedMediaSticker');
  if (document) return lang('ActionPinnedMediaFile');
  if (contact) return lang('ActionPinnedMediaContact');
  if (storyData) return lang('ActionPinnedMediaStory');
  if (pollId) return lang('ActionPinnedMediaPoll');
  if (dice) return dice.emoticon;

  return undefined;
}

export function renderPeerLink(peerId: string | undefined, text: string, asPreview?: boolean) {
  if (!peerId || asPreview) {
    return renderText(text);
  }

  return (
    <Link
      className={buildClassName(styles.peerLink, styles.strong)}

      onClick={(e) => {
        e.stopPropagation();
        getActions().openChat({ id: peerId });
      }}
      // box-decoration-break: clone; is broken when child has `dir` attribute
      // https://bugs.webkit.org/show_bug.cgi?id=296990
      withMultilineFix={IS_SAFARI}
    >
      {renderText(text)}
    </Link>
  );
}

export function renderMessageLink(
  targetMessage: ApiMessage | undefined,
  text: TeactNode,
  asPreview: boolean | undefined,
  params?: {
    noEllipsis?: boolean;
  },
) {
  const { noEllipsis } = params || {};

  if (asPreview || !targetMessage) return text;

  return (
    <Link
      className={buildClassName(styles.messageLink, noEllipsis && styles.noEllipsis)}
      onClick={(e) => {
        e.stopPropagation();
        getActions().focusMessage({ chatId: targetMessage.chatId, messageId: targetMessage.id });
      }}
      withMultilineFix={IS_SAFARI}
    >
      {text}
    </Link>
  );
}
