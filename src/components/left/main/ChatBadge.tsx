import { memo, useCallback } from '../../../lib/teact/teact';

import type { GlobalState } from '../../../global/types';
import { type ApiChat, MAIN_THREAD_ID } from '../../../api/types';

import { selectThreadReadState } from '../../../global/selectors/threads';
import buildClassName from '../../../util/buildClassName';
import { formatIntegerCompact } from '../../../util/text/textFormat';

import useSelector from '../../../hooks/data/useSelector';
import useLang from '../../../hooks/useLang';
import useShowTransitionSwap from '../../../hooks/useShowTransitionSwap';

import AnimatedCounter from '../../common/AnimatedCounter';
import Icon from '../../common/icons/Icon';
import ShowTransition from '../../ui/ShowTransition';

import styles from './ChatBadge.module.scss';

type OwnProps = {
  chat: ApiChat;
  isPinned?: boolean;
  isMuted?: boolean;
  shouldShowOnlyMostImportant?: boolean;
  isSelected?: boolean;
  isOnAvatar?: boolean;
  transitionClassName?: string;
  badgeClassName?: string;
};

const ChatBadge = ({
  chat,
  isPinned,
  isMuted,
  shouldShowOnlyMostImportant,
  isSelected,
  isOnAvatar,
  transitionClassName,
  badgeClassName,
}: OwnProps) => {
  const lang = useLang();

  const readStateSelector = useCallback((global: GlobalState) => {
    return selectThreadReadState(global, chat.id, MAIN_THREAD_ID);
  }, [chat.id]);

  const readState = useSelector(readStateSelector);

  const {
    unreadMentionsCount = 0,
    unreadCount = 0,
    hasUnreadMark,
  } = readState || {};

  const isUnread = Boolean(unreadCount || hasUnreadMark);

  const isShown = Boolean(unreadCount || unreadMentionsCount || hasUnreadMark || isPinned);

  const contentCategory = (isUnread || unreadMentionsCount) ? 'active' : (isPinned ? 'pinned' : 'none');
  const effectiveIsOpen = useShowTransitionSwap(isShown, contentCategory);

  function renderContent() {
    const baseClassName = buildClassName(styles.badge, badgeClassName);
    const statefulClassName = buildClassName(baseClassName, isMuted && styles.muted);

    const unreadMentionsElement = unreadMentionsCount > 0 && (
      <div className={buildClassName(baseClassName, styles.mention, styles.round)}>
        <Icon name="mention" />
      </div>
    );

    const unreadCountElement = isUnread ? (
      <div className={buildClassName(statefulClassName, styles.unread)}>
        {!hasUnreadMark && <AnimatedCounter text={formatIntegerCompact(lang, unreadCount)} />}
      </div>
    ) : undefined;

    const pinnedElement = isPinned && (
      <div className={buildClassName(baseClassName, styles.pinned)}>
        <Icon name="pin-filled" />
      </div>
    );

    const visiblePinnedElement = !unreadCountElement && !unreadMentionsElement && pinnedElement;

    const elements = [
      unreadMentionsElement,
      unreadCountElement,
      visiblePinnedElement,
    ].filter(Boolean);

    if (elements.length === 0) return undefined;

    if (elements.length === 1) return elements[0];

    if (shouldShowOnlyMostImportant) {
      return [unreadMentionsElement, unreadCountElement, pinnedElement].filter(Boolean)[0];
    }

    return (
      <div className={styles.wrapper}>
        {elements}
      </div>
    );
  }

  return (
    <ShowTransition
      isCustom
      className={buildClassName(
        styles.transition,
        isSelected && styles.selected,
        isOnAvatar && styles.onAvatar,
        transitionClassName,
      )}
      isOpen={effectiveIsOpen}
    >
      {renderContent()}
    </ShowTransition>
  );
};

export default memo(ChatBadge);
