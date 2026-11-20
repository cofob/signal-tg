import type { MessageListType, ThreadId } from '../types';
import { MAIN_THREAD_ID } from '../api/types';

let parsedInitialLocationHash: Record<string, string> | undefined;
let messageHash: string | undefined;
let initialLocationHash = '';

captureInitialLocation();

function captureInitialLocation() {
  const url = new URL(window.location.href);
  const hash = url.hash.slice(1);
  const separator = hash.indexOf('?');
  const hasParameters = hash.includes('=') || hash.includes('&');
  const navigation = separator >= 0 ? hash.slice(0, separator) : !hasParameters ? hash : '';
  const parameters = new URLSearchParams(separator >= 0 ? hash.slice(separator + 1) : hasParameters ? hash : '');
  url.hash = navigation + (parameters.size ? `${navigation ? '?' : ''}${parameters}` : '');
  initialLocationHash = url.hash;
  url.hash = navigation;
  if (parameters.size) window.history.replaceState(window.history.state, '', url);

  messageHash = navigation;
  parsedInitialLocationHash = parameters.size ? Object.fromEntries(parameters) : undefined;
}

export function resetInitialLocationHash() {
  messageHash = undefined;
  parsedInitialLocationHash = undefined;
  initialLocationHash = '';
}

export function resetLocationHash() {
  window.location.hash = '';
}

export const createLocationHash = (chatId: string, type: MessageListType, threadId: ThreadId): string => {
  const displayType = type === 'thread' ? undefined : type;
  const parts = threadId === MAIN_THREAD_ID ? [chatId, displayType] : [chatId, threadId, displayType];

  return parts.filter(Boolean).join('_');
};

export function parseLocationHash(currentUserId?: string) {
  parseInitialLocationHash();

  if (!messageHash) return undefined;

  const parts = messageHash.split('_');
  let chatId: string | undefined;
  let type: string | undefined;
  let threadId: string | undefined;
  if (parts.length === 1) {
    chatId = parts[0];
  } else if (parts.length === 2) {
    const isType = ['thread', 'pinned', 'scheduled'].includes(parts[1]);
    chatId = parts[0];
    type = isType ? parts[1] : 'thread';
    threadId = !isType ? parts[1] : undefined;
  } else if (parts.length >= 3) {
    [chatId, threadId, type] = parts;
  }
  if (!chatId?.match(/^-?\d+$/)) return undefined;

  const isType = ['thread', 'pinned', 'scheduled'].includes(type!);

  const castedThreadId = (chatId === currentUserId ? threadId : Number(threadId)) || MAIN_THREAD_ID;

  return {
    chatId,
    type: type && isType ? (type as MessageListType) : 'thread',
    threadId: castedThreadId,
  };
}

export const createMessageHashUrl = (chatId: string, type: MessageListType, threadId: ThreadId): string => {
  const url = new URL(window.location.href);
  url.hash = createLocationHash(chatId, type, threadId);
  return url.href;
};

export function parseInitialLocationHash() {
  return parsedInitialLocationHash;
}

export function getInitialLocationHash() {
  return initialLocationHash;
}
