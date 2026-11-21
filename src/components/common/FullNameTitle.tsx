import { memo, useMemo } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type {
  ApiPeer,
} from '../../api/types';
import type { CustomPeer } from '../../types';

import {
  getChatTitle,
  getUserFullName,
} from '../../global/helpers';
import { isApiPeerUser } from '../../global/helpers/peers';
import buildClassName from '../../util/buildClassName';
import { copyTextToClipboard } from '../../util/clipboard';
import stopEvent from '../../util/stopEvent';
import renderText from './helpers/renderText';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Marquee from '../ui/Marquee';

import styles from './FullNameTitle.module.scss';

type OwnProps = {
  peer: ApiPeer | CustomPeer;
  className?: string;
  style?: string;
  isScrolling?: boolean;
  isScrollingPaused?: boolean;
  isSavedMessages?: boolean;
  canCopyTitle?: boolean;
  iconElement?: React.ReactNode;
};

const FullNameTitle = ({
  className,
  style,
  isScrolling,
  isScrollingPaused,
  peer,
  isSavedMessages,
  canCopyTitle,
  iconElement,
}: OwnProps) => {
  const { showNotification } = getActions();

  const lang = useLang();

  const realPeer = 'id' in peer ? peer : undefined;
  const customPeer = 'isCustomPeer' in peer ? peer : undefined;
  const isUser = realPeer && isApiPeerUser(realPeer);
  const title = realPeer && (isUser ? getUserFullName(lang, realPeer) : getChatTitle(lang, realPeer));

  const handleTitleClick = useLastCallback((e) => {
    if (!title || !canCopyTitle) {
      return;
    }

    stopEvent(e);
    copyTextToClipboard(title);
    showNotification({ message: { key: isUser ? 'UserNameCopied' : 'ChatNameCopied' } });
  });

  const specialTitle = useMemo(() => {
    if (customPeer) {
      return renderText(customPeer.title || lang(customPeer.titleKey!));
    }

    if (isSavedMessages) {
      return lang('NoteToSelf');
    }

    return undefined;
  }, [customPeer, isSavedMessages, lang]);
  const renderedTitle = useMemo(() => specialTitle || renderText(title || ''), [specialTitle, title]);

  return (
    <div
      className={buildClassName('title', styles.root, className)}
      style={style}
    >
      <h3
        dir="auto"
        role="button"
        className={buildClassName(
          'fullName',
          styles.fullName,
          canCopyTitle && styles.canCopy,
        )}
        onClick={handleTitleClick}
      >
        {isScrolling ? <Marquee paused={isScrollingPaused}>{renderedTitle}</Marquee> : renderedTitle}
      </h3>
      {iconElement}
    </div>
  );
};

export default memo(FullNameTitle);
