import { memo, useRef } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiMessage, ApiPeer } from '../../../api/types';

import {
  getMessageIsSpoiler,
  getMessageRoundVideo,
  getMessageSticker,
  getMessageVideo,
} from '../../../global/helpers';
import { isApiPeerUser } from '../../../global/helpers/peers';
import { selectPeer } from '../../../global/selectors';
import buildClassName from '../../../util/buildClassName';
import { type LangFn } from '../../../util/localization';
import { formatCompactTimestamp, secondsToDate } from '../../../util/localization/dateFormat';
import { renderMessageSummary } from '../../common/helpers/renderMessageText';

import useMessageMediaHash from '../../../hooks/media/useMessageMediaHash';
import useThumbnail from '../../../hooks/media/useThumbnail';
import useAppLayout from '../../../hooks/useAppLayout';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import useMedia from '../../../hooks/useMedia';
import useSelectWithEnter from '../../../hooks/useSelectWithEnter';
import useTextHighlight from '../../../hooks/useTextHighlight';

import Avatar from '../../common/Avatar';
import FullNameTitle from '../../common/FullNameTitle';
import Icon from '../../common/icons/Icon';
import Link from '../../ui/Link';
import ListItem from '../../ui/ListItem';

import './ChatMessage.scss';

type OwnProps = {
  searchQuery?: string;
  message: ApiMessage;
  chatId: string;
};

type StateProps = {
  peer?: ApiPeer;
};

const ChatMessage = ({
  message,
  searchQuery,
  chatId,
  peer,
}: OwnProps & StateProps) => {
  const { focusMessage } = getActions();

  const { isMobile } = useAppLayout();
  const thumbDataUri = useThumbnail(message);
  const mediaThumbnail = !getMessageSticker(message) ? thumbDataUri : undefined;
  const mediaHash = useMessageMediaHash(message, 'micro');
  const mediaBlobUrl = useMedia(mediaHash);
  const isRoundVideo = Boolean(getMessageRoundVideo(message));

  const handleClick = useLastCallback(() => {
    focusMessage({
      chatId, messageId: message.id, shouldReplaceHistory: true,
    });
  });

  const lang = useLang();

  const buttonRef = useSelectWithEnter(handleClick);
  const textRef = useRef<HTMLDivElement>();
  useTextHighlight(textRef, { search: peer ? searchQuery : undefined });

  if (!peer) {
    return undefined;
  }

  const user = isApiPeerUser(peer) ? peer : undefined;

  return (
    <ListItem
      className="ChatMessage chat-item-clickable"
      ripple={!isMobile}
      onClick={handleClick}
      buttonRef={buttonRef}
    >
      <Avatar
        peer={peer}
        isSavedMessages={user?.isSelf}
      />
      <div className="info">
        <div className="info-row">
          <FullNameTitle
            peer={peer}
            isSavedMessages={user?.isSelf}
          />
          <div className="message-date">
            <Link className="date">
              {formatCompactTimestamp(lang, secondsToDate(message.date))}
            </Link>
          </div>

        </div>
        <div className="subtitle">
          <div className="message" dir="auto" ref={textRef}>
            {renderSummary(lang, message, mediaBlobUrl || mediaThumbnail, isRoundVideo)}
          </div>
        </div>
      </div>
    </ListItem>
  );
};

function renderSummary(
  lang: LangFn, message: ApiMessage, blobUrl?: string, isRoundVideo?: boolean,
) {
  if (!blobUrl) {
    return renderMessageSummary(lang, message);
  }

  const isSpoiler = getMessageIsSpoiler(message);

  return (
    <span className="media-preview">
      <img
        src={blobUrl}
        alt=""
        className={
          buildClassName('media-preview--image', isRoundVideo && 'round', isSpoiler && 'media-preview-spoiler')
        }
        draggable={false}
      />
      {getMessageVideo(message) && <Icon name="play" />}
      {renderMessageSummary(lang, message, true)}
    </span>
  );
}

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const peer = selectPeer(global, chatId);

    return {
      peer,
    };
  },
)(ChatMessage));
