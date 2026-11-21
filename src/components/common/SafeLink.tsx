import type { TeactNode } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { ThreadId } from '../../types';
import { ApiMessageEntityTypes, type LinkContext } from '../../api/types';

import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { ensureProtocol, getUnicodeUrl, isSuspiciousUrl } from '../../util/browser/url';
import { MouseButton } from '../../util/browser/windowEnvironment';
import buildClassName from '../../util/buildClassName';

import useLastCallback from '../../hooks/useLastCallback';

type OwnProps = {
  url?: string;
  text: string;
  className?: string;
  children?: TeactNode;
  isRtl?: boolean;
  shouldSkipModal?: boolean;
  chatId?: string;
  messageId?: number;
  threadId?: ThreadId;
  entityType?: ApiMessageEntityTypes.Url | ApiMessageEntityTypes.TextUrl |
    `${ApiMessageEntityTypes.TextUrl}` | `${ApiMessageEntityTypes.Url}`;
};

const SafeLink = ({
  url,
  text,
  className,
  children,
  isRtl,
  shouldSkipModal,
  chatId,
  messageId,
  threadId,
  entityType = ApiMessageEntityTypes.Url,
}: OwnProps) => {
  const { openUrl } = getActions();

  const content = children || text;
  // Spoilers, dates or custom emoji can hide or replace parts of link
  const isRegularLink = Boolean(url) && getSinglePlainText(content) === url;

  const handleClick = useLastCallback((e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
    if (!url) return true;
    if (e.button !== MouseButton.Main && e.button !== MouseButton.Auxiliary) return true;

    e.preventDefault();

    const shouldOpenInNewTab = e.button === MouseButton.Auxiliary || e.ctrlKey || e.metaKey || e.shiftKey;
    const linkContext: LinkContext | undefined = chatId && messageId
      ? { type: 'message', chatId, threadId, messageId }
      : undefined;
    // An address that the text of a message holds asks before it opens a site, as in Signal Desktop; Signal's own links
    // open in the app before the question
    const isTrustedLink = isRegularLink && !isSuspiciousUrl(url) && !linkContext;
    openUrl({
      url,
      shouldSkipModal: shouldSkipModal || isTrustedLink,
      ignoreDeepLinks: shouldOpenInNewTab,
      linkContext,
    });

    return false;
  });

  if (!url) {
    return undefined;
  }

  const classNames = buildClassName(
    className || 'text-entity-link',
    isRegularLink && 'word-break-all',
  );

  return (
    <a
      href={ensureProtocol(url)}
      title={getUnicodeUrl(url)}
      target={IS_TAURI ? '_self' : '_blank'}
      rel="noopener noreferrer"
      className={classNames}
      onClick={handleClick}
      onAuxClick={handleClick}
      dir={isRtl ? 'rtl' : 'auto'}
      data-entity-type={entityType}
    >
      {content}
    </a>
  );
};

function getSinglePlainText(node: TeactNode): string | undefined {
  if (Array.isArray(node)) return node.length === 1 ? getSinglePlainText(node[0]) : undefined;
  return typeof node === 'string' ? node : undefined;
}

export default SafeLink;
