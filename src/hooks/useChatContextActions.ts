import { useCallback, useMemo } from '../lib/teact/teact';
import { getActions } from '../global';

import type { MenuItemContextAction } from '../components/ui/ListItem';
import type { GlobalState } from '../global/types';
import { type ApiChat, type ApiUser, MAIN_THREAD_ID } from '../api/types';

import { getCanDeleteChat, isChatArchived } from '../global/helpers';
import { selectThreadReadState } from '../global/selectors/threads';
import { IS_TAURI } from '../util/browser/globalEnvironment';
import { IS_OPEN_IN_NEW_TAB_SUPPORTED } from '../util/browser/windowEnvironment';
import { isUserId } from '../util/entities/ids';
import { compact } from '../util/iteratees';
import useSelector from './data/useSelector';
import useLang from './useLang';

const useChatContextActions = ({
  chat,
  user,
  folderId,
  isPinned,
  isMuted,
  canChangeFolder,
  isPreview,
  handleDelete,
  handleMute,
  handleUnmute,
  handleChatFolderChange,
}: {
  chat: ApiChat | undefined;
  user: ApiUser | undefined;
  folderId?: number;
  isPinned?: boolean;
  isMuted?: boolean;
  canChangeFolder?: boolean;
  isPreview?: boolean;
  handleDelete?: NoneToVoidFunction;
  handleMute?: NoneToVoidFunction;
  handleUnmute?: NoneToVoidFunction;
  handleChatFolderChange: NoneToVoidFunction;
}, isInSearch = false) => {
  const {
    toggleChatPinned,
    toggleChatArchived,
    markChatMessagesRead,
    markChatUnread,
    openChatInNewTab,
    openQuickPreview,
  } = getActions();

  const lang = useLang();

  const { isSelf } = user || {};

  const chatReadStateSelector = useCallback((global: GlobalState) => {
    if (!chat?.id) return undefined;
    return selectThreadReadState(global, chat.id, MAIN_THREAD_ID);
  }, [chat?.id]);
  const chatReadState = useSelector(chatReadStateSelector);

  const deleteTitle = useMemo(() => {
    if (!chat) return undefined;

    if (isUserId(chat.id) || getCanDeleteChat(chat)) {
      return lang('DeleteChat');
    }

    return lang('GroupLeaveGroup');
  }, [chat, lang]);

  const preparedActions = useMemo(() => {
    if (!chat || isPreview) {
      return undefined;
    }

    const actionOpenInNewTab = IS_OPEN_IN_NEW_TAB_SUPPORTED && {
      title: IS_TAURI ? lang('ChatListOpenInNewWindow') : lang('ChatListOpenInNewTab'),
      icon: 'open-in-new-tab',
      handler: () => {
        openChatInNewTab({ chatId: chat.id });
      },
    } satisfies MenuItemContextAction;

    const actionQuickPreview = {
      title: lang('QuickPreview'),
      icon: 'eye-outline',
      handler: () => {
        openQuickPreview({
          id: chat.id,
        });
      },
    } satisfies MenuItemContextAction;

    const togglePinned = () => {
      toggleChatPinned({ id: chat.id, folderId: folderId! });
    };

    const actionPin: MenuItemContextAction = isPinned
      ? {
        title: lang('ChatListUnpinFromTop'),
        icon: 'unpin',
        handler: togglePinned,
      }
      : {
        title: lang('ChatListPinToTop'),
        icon: 'pin',
        handler: togglePinned,
      };

    const actionDelete = deleteTitle ? {
      title: deleteTitle,
      icon: 'delete',
      destructive: true,
      handler: handleDelete,
    } satisfies MenuItemContextAction : undefined;

    const actionAddToFolder = canChangeFolder ? {
      title: lang('ChatListContextAddToFolder'),
      icon: 'folder',
      handler: handleChatFolderChange,
    } satisfies MenuItemContextAction : undefined;

    const actionMute: MenuItemContextAction = isMuted
      ? {
        title: lang('ChatsUnmute'),
        icon: 'unmute',
        handler: handleUnmute,
      }
      : {
        title: `${lang('ChatsMute')}...`,
        icon: 'mute',
        handler: handleMute,
      };

    if (isInSearch) {
      return compact([
        actionOpenInNewTab, actionQuickPreview, actionPin, actionAddToFolder, actionMute,
      ]);
    }

    const actionMarkAsRead = (chatReadState?.unreadCount || chatReadState?.hasUnreadMark) ? {
      title: lang('ChatListContextMarkAsRead'),
      icon: 'readchats',
      handler: () => markChatMessagesRead({ id: chat.id }),
    } satisfies MenuItemContextAction
      : undefined;
    const actionMarkAsUnread = !(chatReadState?.unreadCount || chatReadState?.hasUnreadMark)
      ? {
        title: lang('ChatListContextMarkAsUnread'), icon: 'unread', handler: () => markChatUnread({ id: chat.id }),
      } satisfies MenuItemContextAction
      : undefined;

    const actionArchive: MenuItemContextAction = isChatArchived(chat)
      ? { title: lang('Unarchive'), icon: 'unarchive', handler: () => toggleChatArchived({ id: chat.id }) }
      : { title: lang('Archive'), icon: 'archive', handler: () => toggleChatArchived({ id: chat.id }) };

    const isInFolder = folderId !== undefined;

    return compact<MenuItemContextAction>([
      actionOpenInNewTab,
      actionQuickPreview,
      actionAddToFolder,
      actionMarkAsRead,
      actionMarkAsUnread,
      actionPin,
      !isSelf && actionMute,
      !isSelf && !isInFolder && actionArchive,
      actionDelete,
    ]);
  }, [
    chat, isPreview, lang, isPinned, deleteTitle, handleDelete, canChangeFolder,
    handleChatFolderChange, isMuted, handleUnmute, handleMute, isInSearch, chatReadState,
    folderId, isSelf,
  ]);

  return preparedActions;
};

export default useChatContextActions;
