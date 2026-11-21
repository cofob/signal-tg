import { getGlobal } from '../../../global';

import { selectChat, selectChatLastMessage } from '../../../global/selectors';
import { orderBy } from '../../../util/iteratees';

const PINNED_PRIORITY_BASE = 3e8;

export default function sortChatIds(
  chatIds: string[],
  priorityIds?: string[],
  currentUserId?: string,
) {
  // Avoid calling sort on every global change
  const global = getGlobal();

  return orderBy(chatIds, (id) => {
    if (id === currentUserId) {
      return Infinity;
    }

    const chat = selectChat(global, id);
    if (!chat) {
      return 0;
    }

    let priority = 0;

    const lastMessage = selectChatLastMessage(global, id);
    if (lastMessage) {
      priority += lastMessage.date;
    }

    if (priorityIds && priorityIds.includes(id)) {
      priority = Date.now() + PINNED_PRIORITY_BASE + (priorityIds.length - priorityIds.indexOf(id));
    }

    return priority;
  }, 'desc');
}
