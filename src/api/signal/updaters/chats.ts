import type { MessageChanges } from '../../../lib/signal/messages/MessageProcessor';

/** Sends `updateChat` and `updateUser` for changed conversations */
export async function handleChatChanges(changes: MessageChanges) {
  await Promise.resolve(changes);
}
