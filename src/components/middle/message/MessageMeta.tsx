import type { TeactNode } from '../../../lib/teact/teact';
import { memo, useMemo } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type {
  ApiAvailableReaction, ApiMessage, ApiMessageOutgoingStatus,
} from '../../../api/types';
import type { LangFn } from '../../../util/localization';

import buildClassName from '../../../util/buildClassName';
import {
  formatCalendarDate, formatCompactTimestamp, formatDateTime, isSameLocalDay, secondsToDate,
} from '../../../util/localization/dateFormat';
import { formatIntegerCompact } from '../../../util/text/textFormat';
import renderText from '../../common/helpers/renderText';

import useFlag from '../../../hooks/useFlag';
import useLang from '../../../hooks/useLang';

import Icon from '../../common/icons/Icon';
import MessageOutgoingStatus from '../../common/MessageOutgoingStatus';

import './MessageMeta.scss';

type OwnProps = {
  message: ApiMessage;
  withReactionOffset?: boolean;
  outgoingStatus?: ApiMessageOutgoingStatus;
  signature?: string;
  availableReactions?: ApiAvailableReaction[];
  isPinned?: boolean;
  withFullDate?: boolean;
  isMessagePrimaryEditedDateEnabled: boolean;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onOutgoingStatusClick?: NoneToVoidFunction;
  renderQuickReactionButton?: () => TeactNode | undefined;
};

const MessageMeta = ({
  message,
  outgoingStatus,
  signature,
  withReactionOffset,
  renderQuickReactionButton,
  isPinned,
  withFullDate,
  onClick,
  onOutgoingStatusClick,
  isMessagePrimaryEditedDateEnabled,
}: OwnProps) => {
  const { showNotification } = getActions();

  const [isActivated, markActivated] = useFlag();

  const lang = useLang();

  function handleImportedClick(e: React.MouseEvent) {
    e.stopPropagation();

    showNotification({
      message: {
        key: 'ImportedInfo',
      },
    });
  }

  const dateTitle = useMemo(() => {
    if (!isActivated) return undefined;
    const createDateTime = formatDateTime(lang, secondsToDate(message.date), { date: 'short', time: 'long' });
    const editDateTime = message.isEdited
      && formatDateTime(lang, secondsToDate(message.editDate!), { date: 'short', time: 'long' });
    const forwardedDateTime = message.forwardInfo
      && formatDateTime(
        lang,
        secondsToDate(message.forwardInfo.savedDate || message.forwardInfo.date),
        { date: 'short', time: 'long' },
      );

    let text = createDateTime;
    if (editDateTime) {
      text += '\n';
      text += lang('MessageTooltipEditedDate', { date: editDateTime });
    }
    if (forwardedDateTime) {
      text += '\n';
      text += lang('MessageTooltipForwardedDate', { date: forwardedDateTime });
    }

    return text;
  }, [isActivated, lang, message]);

  const viewsTitle = useMemo(() => {
    if (!message.viewsCount) return undefined;
    let text = lang('MessageTooltipViews', {
      count: lang.number(message.viewsCount),
    }, { pluralValue: message.viewsCount });
    if (message.forwardsCount) {
      text += '\n';
      text += lang('MessageTooltipForwards', {
        count: lang.number(message.forwardsCount),
      }, { pluralValue: message.forwardsCount });
    }

    return text;
  }, [lang, message.forwardsCount, message.viewsCount]);

  const shouldShowPrimaryEditedDate = Boolean(message.isEdited && isMessagePrimaryEditedDateEnabled);

  const date = useMemo(() => {
    if (shouldShowPrimaryEditedDate) {
      return formatEditedDate(lang, message.date, message.editDate!, withFullDate, message.isVideoProcessingPending);
    }

    const time = formatDateTime(lang, secondsToDate(message.date), { time: 'short' });
    return !withFullDate
      ? time
      : formatCompactTimestamp(lang, secondsToDate(message.forwardInfo?.date || message.date), { withTime: true });
  }, [
    lang, message.date, message.editDate, message.forwardInfo?.date, message.isVideoProcessingPending,
    shouldShowPrimaryEditedDate, withFullDate,
  ]);

  const fullClassName = buildClassName(
    'MessageMeta',
    withReactionOffset && 'reactions-offset',
    message.forwardInfo?.isImported && 'is-imported',
  );

  return (
    <span
      className={fullClassName}
      dir={lang.isRtl ? 'rtl' : 'ltr'}
      onClick={onClick}
      data-ignore-on-paste
    >
      {Boolean(message.viewsCount) && (
        <>
          <span className="message-views" title={viewsTitle}>
            {formatIntegerCompact(lang, message.viewsCount)}
          </span>
          <Icon name="eye" />
        </>
      )}
      {isPinned && (
        <Icon name="pin-filled" className="message-pinned" />
      )}
      {signature && (
        <span className="message-signature">{renderText(signature)}</span>
      )}
      <span className="message-time" title={dateTitle} onMouseEnter={markActivated}>
        {Boolean(message.anchorMsgId) && `${lang('EphemeralUpdated')} `}
        {message.forwardInfo?.isImported && (
          <>
            <span className="message-imported" onClick={handleImportedClick}>
              {formatDateTime(lang, secondsToDate(message.forwardInfo.date), { date: 'short', time: 'short' })}
            </span>
            <span className="message-imported" onClick={handleImportedClick}>{lang('MessageMetaImported')}</span>
          </>
        )}
        {message.isEdited && !shouldShowPrimaryEditedDate && `${lang('MessageMetaEdited')} `}
        {message.isVideoProcessingPending && !shouldShowPrimaryEditedDate && `${lang('MessageMetaApproximate')} `}
        {date}
      </span>
      {outgoingStatus && (
        <MessageOutgoingStatus status={outgoingStatus} onClick={onOutgoingStatusClick} />
      )}
      {renderQuickReactionButton && renderQuickReactionButton()}
    </span>
  );
};

function formatEditedDate(
  lang: LangFn, messageDate: number, editDate: number, withFullDate?: boolean, isApproximate?: boolean,
) {
  const editedDate = secondsToDate(editDate);
  const originalDate = secondsToDate(messageDate);
  const formattedTime = formatDateTime(lang, editedDate, { time: 'short' });
  const time = isApproximate ? `${lang('MessageMetaApproximate')} ${formattedTime}` : formattedTime;
  const shouldShowDate = withFullDate || !isSameLocalDay(editedDate, originalDate);

  if (!shouldShowDate) {
    return lang('MessageMetaEditedAtTime', { time });
  }

  const date = formatCalendarDate(lang, editedDate, { variant: 'absolute', isShort: true });

  return lang('MessageMetaEditedOnDateAtTime', { date, time });
}

export default memo(MessageMeta);
