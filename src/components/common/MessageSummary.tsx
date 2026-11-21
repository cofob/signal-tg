import { memo } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type {
  ApiFormattedText, ApiMessage, ApiMessagePoll, ApiTypeStory,
  ApiWebPage,
} from '../../api/types';
import type { ObserveFn } from '../../hooks/useIntersectionObserver';

import {
  extractMessageText,
  getMessagePollId,
  groupStatefulContent,
  isActionMessage,
} from '../../global/helpers';
import {
  getMessageSummaryDescription,
  getMessageSummaryEmoji,
  TRUNCATED_SUMMARY_LENGTH,
} from '../../global/helpers/messageSummary';
import { selectPeerStory, selectPollFromMessage, selectWebPageFromMessage } from '../../global/selectors';
import trimText from '../../util/text/trimText';
import renderText from './helpers/renderText';

import useLang from '../../hooks/useLang';

import ActionMessageText from '../middle/message/ActionMessageText';
import MessageText from './MessageText';

type OwnProps = {
  message: ApiMessage;
  forcedText?: ApiFormattedText;
  noEmoji?: boolean;
  truncateLength?: number;
  withTranslucentThumbs?: boolean;
  emojiSize?: number;
  observeIntersectionForLoading?: ObserveFn;
  observeIntersectionForPlaying?: ObserveFn;
};

type StateProps = {
  poll?: ApiMessagePoll;
  story?: ApiTypeStory;
  webPage?: ApiWebPage;
};

function MessageSummary({
  message,
  forcedText,
  noEmoji,
  truncateLength = TRUNCATED_SUMMARY_LENGTH,
  withTranslucentThumbs,
  emojiSize,
  poll,
  story,
  webPage,
  observeIntersectionForLoading,
  observeIntersectionForPlaying,
}: OwnProps & StateProps) {
  const lang = useLang();
  const extractedText = extractMessageText(message);
  const hasPoll = Boolean(getMessagePollId(message));
  const isAction = isActionMessage(message);

  const statefulContent = groupStatefulContent({ poll, story, webPage });
  const emoji = !noEmoji && getMessageSummaryEmoji(message);

  if (!extractedText && !hasPoll && !isAction) {
    if (forcedText?.text) {
      const trimmedText = trimText(forcedText.text, truncateLength);

      return (
        <span>
          {renderText(trimmedText)}
        </span>
      );
    }

    const description = getMessageSummaryDescription(lang, message, statefulContent);

    if (typeof description !== 'string') {
      return (
        <span>
          {[
            emoji ? renderText(`${emoji} `) : undefined,
            description,
          ].flat().filter(Boolean)}
        </span>
      );
    }

    const emojiWithSpace = emoji ? `${emoji} ` : '';
    const summaryText = `${emojiWithSpace}${description}`;
    const trimmedText = trimText(summaryText, truncateLength);

    return (
      <span>
        {renderText(trimmedText)}
      </span>
    );
  }

  function renderMessageText() {
    if (isAction) {
      return <ActionMessageText message={message} asPreview />;
    }

    return (
      <MessageText
        messageOrStory={message}
        forcedText={forcedText}
        asPreview
        observeIntersectionForLoading={observeIntersectionForLoading}
        observeIntersectionForPlaying={observeIntersectionForPlaying}
        withTranslucentThumbs={withTranslucentThumbs}
        truncateLength={truncateLength}
        emojiSize={emojiSize}
      />
    );
  }

  return (
    <>
      {[
        emoji ? renderText(`${emoji} `) : undefined,
        getMessageSummaryDescription(lang, message, statefulContent, renderMessageText()),
      ].flat().filter(Boolean)}
    </>
  );
}

export default memo(withGlobal<OwnProps>(
  (global, { message }): Complete<StateProps> => {
    const poll = selectPollFromMessage(global, message);
    const webPage = selectWebPageFromMessage(global, message);
    const storyData = message.content.storyData;
    const story = storyData && selectPeerStory(global, storyData.peerId, storyData.id);

    return {
      poll,
      story,
      webPage,
    };
  },
)(MessageSummary));
