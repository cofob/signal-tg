import { Fragment, useCallback, useMemo } from '../../../lib/teact/teact';

import type {
  ApiChat,
  ApiMessage, ApiPeer, ApiReplyInfo, MediaContainer,
} from '../../../api/types';
import type { GlobalState } from '../../../global/types';
import type { ObserveFn } from '../../../hooks/useIntersectionObserver';
import type { IconName } from '../../../types/icons';

import {
  getMessageIsSpoiler,
  getMessageRoundVideo,
  isChatGroup,
} from '../../../global/helpers';
import { getMediaContentTypeDescription } from '../../../global/helpers/messageSummary';
import { getPeerTitle } from '../../../global/helpers/peers';
import { selectReplyOptionText } from '../../../global/selectors';
import buildClassName from '../../../util/buildClassName';
import { isUserId } from '../../../util/entities/ids';
import { normalizeRichQuote } from '../../../util/text/richQuote';
import renderText from '../helpers/renderText';
import { renderTextWithEntities } from '../helpers/renderTextWithEntities';

import useSelector from '../../../hooks/data/useSelector';
import useLang from '../../../hooks/useLang';
import useUniqueId from '../../../hooks/useUniqueId';

import RichText from '../../iv/RichText';
import RippleEffect from '../../ui/RippleEffect';
import CompactMediaPreview, { canRenderCompactMediaPreview } from '../CompactMediaPreview';
import Icon from '../icons/Icon';
import MessageSummary from '../MessageSummary';
import PeerColorWrapper from '../PeerColorWrapper';

import './EmbeddedMessage.scss';

type OwnProps = {
  className?: string;
  replyInfo?: ApiReplyInfo;
  message?: ApiMessage;
  sender?: ApiPeer;
  senderChat?: ApiChat;
  forwardSender?: ApiPeer;
  composerForwardSenders?: ApiPeer[];
  title?: string;
  customText?: string;
  noUserColors?: boolean;
  isProtected?: boolean;
  isInComposer?: boolean;
  isOpen?: boolean;
  isMediaNsfw?: boolean;
  noCaptions?: boolean;
  pictogramActionIcon?: IconName;
  observeIntersectionForLoading?: ObserveFn;
  observeIntersectionForPlaying?: ObserveFn;
  onClick?: ((e: React.MouseEvent) => void);
  onPictogramClick?: ((e: React.MouseEvent) => void);
};

const NBSP = '\u00A0';
const EMOJI_SIZE = 17;

const EmbeddedMessage = ({
  className,
  message,
  replyInfo,
  sender,
  senderChat,
  forwardSender,
  composerForwardSenders,
  title,
  customText,
  isProtected,
  isInComposer,
  noUserColors,
  isMediaNsfw,
  noCaptions,
  pictogramActionIcon,
  observeIntersectionForLoading,
  observeIntersectionForPlaying,
  onClick,
  onPictogramClick,
}: OwnProps) => {
  const containerId = useUniqueId();
  const quoteRich = replyInfo?.type === 'message' ? replyInfo.quoteRich : undefined;
  const normalizedQuoteRich = useMemo(() => quoteRich?.map(normalizeRichQuote), [quoteRich]);
  const containedMedia: MediaContainer | undefined = useMemo(() => {
    const media = (replyInfo?.type === 'message' && replyInfo.replyMedia) || message?.content;
    if (!media) {
      return undefined;
    }

    return {
      content: media,
    };
  }, [message, replyInfo]);
  const optionMedia = message || containedMedia;
  const selectOptionText = useCallback((global: GlobalState) => (
    optionMedia && replyInfo?.type === 'message'
      ? selectReplyOptionText(global, optionMedia, replyInfo) : undefined
  ), [optionMedia, replyInfo]);
  const replyOptionText = useSelector(selectOptionText);
  // Poll options always show a check, like in other clients
  const isReplyOptionCompleted = replyInfo?.type === 'message' && replyInfo.pollOption !== undefined;
  const hasPictogram = canRenderCompactMediaPreview(containedMedia?.content);

  const isRoundVideo = Boolean(containedMedia && getMessageRoundVideo(containedMedia));
  const isSpoiler = Boolean(containedMedia && getMessageIsSpoiler(containedMedia)) || isMediaNsfw;
  const isQuote = Boolean(replyInfo?.type === 'message' && replyInfo.isQuote);
  const replyForwardInfo = replyInfo?.type === 'message' ? replyInfo.replyFrom : undefined;

  const lang = useLang();

  const senderTitle = sender ? getPeerTitle(lang, sender)
    : (replyForwardInfo?.hiddenUserName || message?.forwardInfo?.hiddenUserName);

  const forwardSendersTitle = useMemo(() => {
    if (!composerForwardSenders) return undefined;

    const peerTitles = composerForwardSenders.map((peer) => getPeerTitle(lang, peer)).filter(Boolean);
    return lang.conjunction(peerTitles);
  }, [composerForwardSenders, lang]);

  const senderChatTitle = senderChat ? getPeerTitle(lang, senderChat) : undefined;
  const forwardSenderTitle = forwardSender ? getPeerTitle(lang, forwardSender)
    : message?.forwardInfo?.hiddenUserName;
  const areSendersSame = sender && sender.id === forwardSender?.id;

  function renderTextContent() {
    if (replyOptionText) {
      return (
        <>
          <Icon
            name={isReplyOptionCompleted ? 'select-filled' : 'placeholder'}
            className={buildClassName('embedded-option-icon in-text-icon', !isReplyOptionCompleted && 'is-incomplete')}
          />
          {renderTextWithEntities({
            ...replyOptionText,
            asPreview: true,
            emojiSize: EMOJI_SIZE,
            observeIntersectionForLoading,
            observeIntersectionForPlaying,
          })}
        </>
      );
    }

    if (normalizedQuoteRich?.length) {
      return normalizedQuoteRich.map((text, index) => (
        <Fragment key={index}>
          {index > 0 && '\n'}
          <RichText
            text={text}
            asPreview
            unsupportedText={lang('MessageUnsupported')}
            containerId={containerId}
            observeIntersectionForLoading={observeIntersectionForLoading}
            observeIntersectionForPlaying={observeIntersectionForPlaying}
          />
        </Fragment>
      ));
    }

    if (replyInfo?.type === 'message' && replyInfo.quoteText) {
      return renderTextWithEntities({
        text: replyInfo.quoteText.text,
        entities: replyInfo.quoteText.entities,
        asPreview: true,
        emojiSize: EMOJI_SIZE,
      });
    }

    if (!message) {
      return customText || renderMediaContentType(containedMedia) || NBSP;
    }

    if (noCaptions) {
      return lang('EmbeddedMessageNoCaption');
    }

    return (
      <MessageSummary
        message={message}
        noEmoji={hasPictogram}
        observeIntersectionForLoading={observeIntersectionForLoading}
        observeIntersectionForPlaying={observeIntersectionForPlaying}
        emojiSize={EMOJI_SIZE}
      />
    );
  }

  function renderMediaContentType(media?: MediaContainer) {
    if (!media || media.content.text) return NBSP;
    const description = getMediaContentTypeDescription(lang, media.content, {});
    if (!description) return NBSP;
    return (
      <span>
        {renderText(description)}
      </span>
    );
  }

  function checkShouldRenderSenderTitle() {
    if (!senderChat) return true;
    if (isUserId(senderChat?.id)) return true;
    if (senderChat.id === sender?.id) return false;
    return true;
  }
  function renderSender() {
    if (title) {
      return renderText(title);
    }

    if (!senderTitle && !forwardSendersTitle) {
      // Keep the sender subtree structure stable while the peer is still loading — replacing
      // a bare text node with an element subtree later makes WebKit shift `scrollTop`
      return (
        <span className="embedded-sender-wrapper">
          <span className="embedded-sender">{NBSP}</span>
        </span>
      );
    }

    let icon: IconName | undefined;
    if (senderChat) {
      if (isChatGroup(senderChat)) {
        icon = 'group-filled';
      }
    }

    const isReplyToQuote = isInComposer && replyInfo?.type === 'message'
      && Boolean(replyInfo.quoteText || replyInfo.quoteRich?.length);

    return (
      <span className="embedded-sender-wrapper">
        {checkShouldRenderSenderTitle() && (
          <span className="embedded-sender">
            {!composerForwardSenders && senderTitle
              && renderText(isReplyToQuote ? lang('ReplyToQuote', { senderTitle }) : senderTitle)}
            {forwardSendersTitle && renderText(lang('ComposerTitleForwardFrom', {
              users: forwardSendersTitle,
            }, {
              withNodes: true,
              withMarkdown: true,
            }))}
          </span>
        )}
        {icon && <Icon name={icon} className="embedded-chat-icon" />}
        {icon && senderChatTitle && (
          <span className="embedded-sender-chat">
            {renderText(senderChatTitle)}
          </span>
        )}
      </span>
    );
  }

  function renderForwardSender() {
    return forwardSenderTitle && !areSendersSame && (
      <span className="embedded-forward-sender-wrapper">
        <Icon name={forwardSender ? 'share-filled' : 'forward'} className="embedded-origin-icon" />
        <span className="forward-sender-title">
          {renderText(forwardSenderTitle)}
        </span>
      </span>
    );
  }

  return (
    <PeerColorWrapper
      peer={sender}
      emojiIconClassName="EmbeddedMessage--background-icons"
      shouldReset
      isReply={Boolean(replyInfo)}
      noUserColors={noUserColors}
      className={buildClassName(
        'EmbeddedMessage',
        className,
        isQuote && 'is-quote',
        hasPictogram && 'with-thumb',
        'no-selection',
        composerForwardSenders && 'is-input-forward',
      )}
      dir={lang.isRtl ? 'rtl' : undefined}
      onClick={onClick}
    >
      <RippleEffect />
      {hasPictogram && (
        <CompactMediaPreview
          media={containedMedia?.content}
          className="embedded-thumb"
          isPictogram
          isRound={isRoundVideo}
          isProtected={isProtected}
          isSpoiler={isSpoiler}
          actionIcon={pictogramActionIcon}
          observeIntersectionForLoading={observeIntersectionForLoading}
          observeIntersectionForPlaying={observeIntersectionForPlaying}
          onClick={onPictogramClick}
        />
      )}
      <div className="message-text">
        <p className={buildClassName(
          'embedded-text-wrapper', isQuote && 'multiline', Boolean(quoteRich?.length) && 'has-rich-quote',
        )}
        >
          {renderTextContent()}
        </p>
        <div className="message-title">
          {renderSender()}
          {renderForwardSender()}
        </div>
      </div>
    </PeerColorWrapper>
  );
};

export default EmbeddedMessage;
