import MessageDb from '../../lib/signal/db/MessageDb';
import MessageProcessor from '../../lib/signal/messages/MessageProcessor';
import SignalClient from '../../lib/signal/SignalClient';
import SignalStore from '../../lib/signal/store/SignalStore';
import { handleChatChanges } from './updaters/chats';
import { handleMessageChanges, handleTyping } from './updaters/messages';

/** The Signal engine of this worker: protocol store, message database, connections and processing */
export const store = new SignalStore();
export const db = new MessageDb();
export const client = new SignalClient(store);
export const processor = new MessageProcessor(db, client, {
  onChanges: (changes) => {
    void handleChatChanges(changes).catch(logError);
    void handleMessageChanges(changes).catch(logError);
  },
  onTyping: (event) => void handleTyping(event).catch(logError),
  onError: logError,
});

export function logError(error: unknown) {
  // eslint-disable-next-line no-console
  console.error('[signal]', error);
}
