import {
  memo, useMemo, useRef, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { IAnchorPosition, MessageListType, ThreadId } from '../../types';
import { MAIN_THREAD_ID } from '../../api/types';
import { ManagementScreens } from '../../types';

import { requestMeasure, requestNextMutation } from '../../lib/fasterdom/fasterdom';
import {
  getIsSavedDialog,
  isChatChannel, isChatSuperGroup,
} from '../../global/helpers';
import {
  selectCanAnimateInterface,
  selectChat,
  selectChatFullInfo,
  selectIsChatRestricted,
  selectIsChatWithSelf,
  selectIsInSelectMode,
  selectIsRightColumnShown,
  selectLanguageCode,
} from '../../global/selectors';
import { isUserId } from '../../util/entities/ids';
import focusNoScroll from '../../util/focusNoScroll';

import useKeyboardShortcutHint from '../../hooks/useKeyboardShortcutHint';
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import HeaderMenuContainer from './HeaderMenuContainer.async';

interface OwnProps {
  chatId: string;
  threadId: ThreadId;
  messageListType: MessageListType;
  isForForum?: boolean;
  isMobile?: boolean;
  onTopicSearch?: NoneToVoidFunction;
}

interface StateProps {
  noMenu?: boolean;
  isChannel?: boolean;
  isRightColumnShown?: boolean;
  canSubscribe?: boolean;
  canSearch?: boolean;
  canMute?: boolean;
  canLeave?: boolean;
  channelMonoforumId?: string;
  pendingJoinRequests?: number;
  noAnimation?: boolean;
  language: string;
}

const HeaderActions = ({
  chatId,
  threadId,
  noMenu,
  isMobile,
  isChannel,
  canSubscribe,
  canSearch,
  canMute,
  canLeave,
  channelMonoforumId,
  pendingJoinRequests,
  isRightColumnShown,
  isForForum,
  noAnimation,
  language,
  onTopicSearch,
}: OwnProps & StateProps) => {
  const {
    openMiddleSearch,
    requestNextManagementScreen,
    openChat,
    setViewForumAsMessages,
  } = getActions();
  const menuButtonRef = useRef<HTMLButtonElement>();

  const lang = useLang();
  const searchLabel = useKeyboardShortcutHint(lang('ConversationSearchPlaceholder'), 'searchInChat');

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<IAnchorPosition | undefined>(undefined);

  const handleHeaderMenuOpen = useLastCallback(() => {
    setIsMenuOpen(true);
    const rect = menuButtonRef.current!.getBoundingClientRect();
    setMenuAnchor({ x: rect.right, y: rect.bottom });
  });

  const handleHeaderMenuClose = useLastCallback(() => {
    setIsMenuOpen(false);
  });

  const handleHeaderMenuHide = useLastCallback(() => {
    setMenuAnchor(undefined);
  });

  const handleJoinRequestsClick = useLastCallback(() => {
    requestNextManagementScreen({ screen: ManagementScreens.JoinRequests });
  });

  const handleSearchClick = useLastCallback(() => {
    if (isForForum) {
      onTopicSearch?.();
      return;
    }

    openMiddleSearch();

    if (noAnimation) {
      // The second RAF is necessary because Teact must update the state and render the async component
      requestMeasure(() => {
        requestNextMutation(setFocusInSearchInput);
      });
    } else {
      setFocusInSearchInput();
    }
  });

  const handleAsMessagesClick = useLastCallback(() => {
    openChat({ id: chatId });
    setViewForumAsMessages({ chatId, isEnabled: true });
  });

  useKeyboardShortcuts(useMemo(() => (canSearch ? {
    searchInChat: handleSearchClick,
  } : undefined), [canSearch]));

  return (
    <div className="HeaderActions">
      {!isMobile && (
        <>
          {canSearch && (
            <Button
              round
              ripple={isRightColumnShown}
              color="translucent"
              size="smaller"
              onClick={handleSearchClick}
              ariaLabel={searchLabel}
              iconName="search"
            />
          )}
        </>
      )}
      {!isForForum && Boolean(pendingJoinRequests) && (
        <Button
          round
          className="badge-button"
          ripple={isRightColumnShown}
          color="translucent"
          size="smaller"
          iconName="user"
          onClick={handleJoinRequestsClick}
          ariaLabel={isChannel ? lang('SubscribeRequests') : lang('MemberRequests')}
        >
          <div className="badge">{pendingJoinRequests}</div>
        </Button>
      )}
      <Button
        ref={menuButtonRef}
        className={isMenuOpen ? 'active' : ''}
        round
        ripple={!isMobile}
        size="smaller"
        color="translucent"
        disabled={noMenu}
        ariaLabel={lang('AccDescrMoreOptions')}
        onClick={handleHeaderMenuOpen}
        iconName="more"
      />
      {menuAnchor && (
        <HeaderMenuContainer
          chatId={chatId}
          threadId={threadId}
          isOpen={isMenuOpen}
          anchor={menuAnchor}
          isChannel={isChannel}
          canSubscribe={isForForum ? canSubscribe : undefined}
          canSearch={canSearch}
          canMute={canMute}
          canLeave={canLeave}
          pendingJoinRequests={pendingJoinRequests}
          onJoinRequestsClick={handleJoinRequestsClick}
          withForumActions={isForForum}
          channelMonoforumId={channelMonoforumId}
          onSearchClick={handleSearchClick}
          onAsMessagesClick={handleAsMessagesClick}
          onClose={handleHeaderMenuClose}
          onCloseAnimationEnd={handleHeaderMenuHide}
        />
      )}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, {
    chatId, threadId, messageListType, isMobile,
  }): Complete<StateProps> => {
    const chat = selectChat(global, chatId);
    const isChannel = Boolean(chat && isChatChannel(chat));
    const isSuperGroup = Boolean(chat && isChatSuperGroup(chat));
    const language = selectLanguageCode(global);
    const isPrivate = isUserId(chatId);

    const isRestricted = selectIsChatRestricted(global, chatId);
    if (!chat || isRestricted || selectIsInSelectMode(global)) {
      return {
        noMenu: true,
        language,
      } as Complete<StateProps>;
    }

    const chatFullInfo = !isPrivate ? selectChatFullInfo(global, chatId) : undefined;
    const isChatWithSelf = selectIsChatWithSelf(global, chatId);
    const isMainThread = messageListType === 'thread' && threadId === MAIN_THREAD_ID;
    const isDiscussionThread = messageListType === 'thread' && threadId !== MAIN_THREAD_ID;
    const isRightColumnShown = selectIsRightColumnShown(global, isMobile);

    const isSavedDialog = getIsSavedDialog(chatId, threadId, global.currentUserId);

    const canSubscribe = Boolean(
      (isMainThread || chat.isForum) && (isChannel || isSuperGroup) && chat.isNotJoined && !chat.isMonoforum,
    );
    const canSearch = isMainThread || isDiscussionThread;
    const canMute = isMainThread && !isChatWithSelf && !canSubscribe;
    const canLeave = isSavedDialog || (isMainThread && !canSubscribe);
    const pendingJoinRequests = isMainThread ? chatFullInfo?.requestsPending : undefined;
    const noAnimation = !selectCanAnimateInterface(global);

    const channelMonoforumId = isChatChannel(chat) ? chat.linkedMonoforumId : undefined;

    return {
      noMenu: false,
      isChannel,
      isRightColumnShown,
      canSubscribe,
      canSearch,
      canMute,
      canLeave,
      pendingJoinRequests,
      noAnimation,
      language,
      channelMonoforumId,
    };
  },
)(HeaderActions));

function setFocusInSearchInput() {
  const searchInput = document.querySelector<HTMLInputElement>('#MiddleSearch input');
  if (searchInput) {
    focusNoScroll(searchInput);
  }
}
