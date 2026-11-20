import type { MessageChanges, TypingEvent } from '../../../lib/signal/messages/MessageProcessor';

/** Sends message updates for added, changed and deleted messages */
export async function handleMessageChanges(changes: MessageChanges) {
  await Promise.resolve(changes);
}

/** Sends typing status updates */
export async function handleTyping(event: TypingEvent) {
  await Promise.resolve(event);
}
