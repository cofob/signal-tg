import type { ConversationRecord } from '../../../lib/signal/db/MessageDb';
import type { ApiSignalChatStyle } from '../../types';

import { getChatStyleColors } from '../../../lib/signal/chatStyle/chatStyle';
import { store } from '../engine';

/** The chat color and wallpaper of a conversation; `undefined` when neither the chat nor the account sets one */
export async function buildApiChatStyle(conversation: ConversationRecord): Promise<ApiSignalChatStyle | undefined> {
  const account = await store.getItem('account');
  const { bubble, wallpaper } = getChatStyleColors(
    conversation.chatStyle, account?.defaultChatStyle, account?.customChatColors,
  );
  return bubble || wallpaper ? { bubbleColor: bubble, wallpaper } : undefined;
}
