import MessageDb from '../../lib/signal/db/MessageDb';
import GroupManager from '../../lib/signal/groups/GroupManager';
import MessageProcessor from '../../lib/signal/messages/MessageProcessor';
import { isPniServiceId } from '../../lib/signal/serviceId';
import SignalClient from '../../lib/signal/SignalClient';
import SignalStore from '../../lib/signal/store/SignalStore';
import { handleChatChanges } from './updaters/chats';
import { handleMessageChanges, handleTyping } from './updaters/messages';

/** The Signal engine of this worker: protocol store, message database, connections and processing */
export const store = new SignalStore();
export const db = new MessageDb();
export const client = new SignalClient(store);
// Change batches reach the app in order, and each batch's messages before its chats: the app counts unread
// messages from `newMessage` updates, so a read state must not overtake the messages it covers
let updateChain = Promise.resolve();

export const processor = new MessageProcessor(db, client, {
  onChanges: (changes) => {
    updateChain = updateChain
      .then(() => handleMessageChanges(changes))
      .then(() => handleChatChanges(changes))
      .catch(logError);
  },
  onTyping: (event) => void handleTyping(event).catch(logError),
  onError: logError,
});

export const groups = new GroupManager(client, db, processor);

// Safety number change notices; PNI identities belong to phone numbers, which have no conversation of their own
store.onIdentityChange = (serviceId) => {
  if (!isPniServiceId(serviceId)) void processor.addSafetyNumberChange(serviceId).catch(logError);
};

export function logError(error: unknown) {
  // eslint-disable-next-line no-console
  console.error('[signal]', error);
}
