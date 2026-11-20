import type { DecryptedEnvelope } from '../receiver/decryptEnvelope';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord } from '../store/SignalStore';

import { SIGNAL_CHAT_HOST } from '../config';
import { getAccountCredentials } from '../account/linkDevice';
import { getBasicAuthorization } from '../net/rest';
import { decryptEnvelope } from '../receiver/decryptEnvelope';

import ResourceSocket from '../net/ResourceSocket';
import { Envelope, Envelope_Type } from '../proto/generated/SignalService';

type ChatConnectionHandlers = {
  onEnvelope(decrypted: DecryptedEnvelope): void;
  onDeliveryReceipt(envelope: Envelope): void;
  onDecryptionError(envelope: Envelope, error: Error): void;
  onQueueEmpty(): void;
  onClose(code: number, reason: string): void;
};

const CHAT_PATH = '/v1/websocket/';
const MESSAGE_PATH = '/api/v1/message';
const QUEUE_EMPTY_PATH = '/api/v1/queue/empty';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

/**
 * The authenticated chat socket of the linked device. Each envelope is stored before it is acknowledged
 * and processed in arrival order, so a closed tab does not lose messages.
 */
export default class ChatConnection {
  private queue = Promise.resolve();

  private constructor(
    private socket: ResourceSocket,
    private store: SignalStore,
    private account: AccountRecord,
    private handlers: ChatConnectionHandlers,
  ) {
    socket.onRequest = (request) => {
      if (request.verb === 'PUT' && request.path === MESSAGE_PATH && request.body) {
        const body = request.body;
        const id = crypto.randomUUID();
        void this.store.addUnprocessed({ id, envelope: body, receivedAt: Date.now() }).then(() => {
          request.respond(HTTP_OK, 'OK');
          this.enqueue(id, body);
        });
        return;
      }
      if (request.verb === 'PUT' && request.path === QUEUE_EMPTY_PATH) {
        request.respond(HTTP_OK, 'OK');
        this.queue = this.queue.then(() => this.handlers.onQueueEmpty());
        return;
      }
      request.respond(HTTP_NOT_FOUND, 'Not found');
    };
    socket.onClose = handlers.onClose;
  }

  static async connect(store: SignalStore, account: AccountRecord, handlers: ChatConnectionHandlers) {
    const socket = await ResourceSocket.connect(SIGNAL_CHAT_HOST, CHAT_PATH, {
      Authorization: getBasicAuthorization(getAccountCredentials(account)),
      'X-Signal-Receive-Stories': 'true',
    });
    const connection = new ChatConnection(socket, store, account, handlers);

    // Envelopes acknowledged before the previous session ended
    for (const { id, envelope } of await store.getAllUnprocessed()) {
      connection.enqueue(id, envelope);
    }
    return connection;
  }

  close() {
    this.socket.close();
  }

  private enqueue(id: string, body: Uint8Array) {
    this.queue = this.queue
      .then(() => this.processEnvelope(body))
      .finally(() => this.store.removeUnprocessed(id));
  }

  private async processEnvelope(body: Uint8Array) {
    const envelope = Envelope.decode(body);
    if (envelope.type === Envelope_Type.SERVER_DELIVERY_RECEIPT) {
      this.handlers.onDeliveryReceipt(envelope);
      return;
    }

    try {
      this.handlers.onEnvelope(await decryptEnvelope(this.store, this.account, envelope));
    } catch (err) {
      this.handlers.onDecryptionError(envelope, err as Error);
    }
  }
}
