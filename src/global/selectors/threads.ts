import type { TabThread, ThreadId, ThreadLocalState } from '../../types';
import type { GlobalState, TabArgs } from '../types';
import { MAIN_THREAD_ID } from '../../api/types';

import { getCurrentTabId } from '../../util/establishMultitabRole';
import { selectTabState } from './tabs';

export function selectTabThreadParam<T extends GlobalState, K extends keyof TabThread>(
  global: T,
  chatId: string,
  threadId: ThreadId,
  key: K,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return selectTabState(global, tabId).tabThreads[chatId]?.[threadId]?.[key];
}

export function selectThreadInfo<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThread(global, chatId, threadId)?.threadInfo;
}

export function selectThreadReadState<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThread(global, chatId, threadId)?.readState;
}

export function selectThreadLocalStateParam<T extends GlobalState, K extends keyof ThreadLocalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
  key: K,
) {
  return selectThreadLocalState(global, chatId, threadId)?.[key];
}

export function selectThread<T extends GlobalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
) {
  const messageInfo = global.messages.byChatId[chatId];
  if (!messageInfo) {
    return undefined;
  }

  const thread = messageInfo.threadsById[threadId];
  if (!thread) {
    return undefined;
  }

  return thread;
}

export function selectThreadLocalState<T extends GlobalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
) {
  return selectThread(global, chatId, threadId)?.localState;
}

export function selectScrollOffset<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return selectTabThreadParam(global, chatId, threadId, 'scrollOffset', tabId);
}

export function selectLastScrollOffset<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'lastScrollOffset');
}

export function selectEditingId<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'editingId');
}

export function selectEditingDraft<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'editingDraft');
}

export function selectEditingScheduledId<T extends GlobalState>(global: T, chatId: string) {
  return selectThreadLocalStateParam(global, chatId, MAIN_THREAD_ID, 'editingScheduledId');
}

export function selectEditingScheduledDraft<T extends GlobalState>(global: T, chatId: string) {
  return selectThreadLocalStateParam(global, chatId, MAIN_THREAD_ID, 'editingScheduledDraft');
}

export function selectDraft<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'draft');
}

export function selectNoWebPage<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'noWebPage');
}

export function selectReplyStack<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return selectTabThreadParam(global, chatId, threadId, 'replyStack', tabId);
}
