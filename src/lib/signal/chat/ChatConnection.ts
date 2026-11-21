import { fromBinary, toBinary } from '@bufbuild/protobuf';

import type { Envelope } from '../proto/generated/SignalService_pb';
import type { DecryptedEnvelope } from '../receiver/decryptEnvelope';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord, UnprocessedEnvelope } from '../store/SignalStore';

import { SIGNAL_CHAT_HOST } from '../config';
import { getAccountCredentials } from '../account/linkDevice';
import { getBasicAuthorization } from '../net/rest';
import { decryptEnvelope } from '../receiver/decryptEnvelope';

import ResourceSocket from '../net/ResourceSocket';
import { ContentSchema, Envelope_Type, EnvelopeSchema } from '../proto/generated/SignalService_pb';

type ChatConnectionHandlers = {
  onEnvelope(decrypted: DecryptedEnvelope): Promise<void> | void;
  onDeliveryReceipt(envelope: Envelope): Promise<void> | void;
  onDecryptionError(envelope: Envelope, error: Error): Promise<void> | void;
  onQueueEmpty(): void;
  onClose(code: number, reason: string): void;
  // A handler failed; the envelope is dropped and processing continues
  onError(error: Error): void;
};

const CHAT_PATH = '/v1/websocket/';
const MESSAGE_PATH = '/api/v1/message';
const QUEUE_EMPTY_PATH = '/api/v1/queue/empty';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

/**
 * The authenticated chat socket of the linked device. Each envelope is stored before it is acknowledged,
 * stored again with its plaintext once decrypted, and removed after its handler finishes. Envelopes are
 * processed in arrival order, so a closed tab does not lose messages.
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
        const entry = { id: crypto.randomUUID(), envelope: request.body, receivedAt: Date.now() };
        this.store.addUnprocessed(entry).then(() => {
          request.respond(HTTP_OK, 'OK');
          this.enqueue(entry);
        }, (err: Error) => {
          // The server keeps an envelope it got no acknowledgement for and delivers it again
          request.respond(HTTP_SERVER_ERROR, 'Could not store the envelope');
          handlers.onError(err);
        });
        return;
      }
      if (request.verb === 'PUT' && request.path === QUEUE_EMPTY_PATH) {
        request.respond(HTTP_OK, 'OK');
        this.run(() => this.handlers.onQueueEmpty());
        return;
      }
      request.respond(HTTP_NOT_FOUND, 'Not found');
    };
    socket.onClose = handlers.onClose;
  }

  static async connect(store: SignalStore, account: AccountRecord, handlers: ChatConnectionHandlers) {
    const socket = await ResourceSocket.connect(SIGNAL_CHAT_HOST, CHAT_PATH, 'authenticated', {
      Authorization: getBasicAuthorization(getAccountCredentials(account)),
      'X-Signal-Receive-Stories': 'true',
    });
    const connection = new ChatConnection(socket, store, account, handlers);

    // Envelopes acknowledged before the previous session ended
    for (const entry of await store.getAllUnprocessed()) {
      connection.enqueue(entry);
    }
    return connection;
  }

  /** Closes the socket; the result settles once the envelopes that it received are processed */
  close() {
    this.socket.close();
    return this.queue;
  }

  /** Sends a JSON request on the authenticated socket */
  sendJsonRequest<T>(verb: string, path: string, json?: unknown) {
    return this.socket.sendJsonRequest<T>(verb, path, json);
  }

  private enqueue(entry: UnprocessedEnvelope) {
    this.run(async () => {
      try {
        await this.processEnvelope(entry);
      } finally {
        await this.store.removeUnprocessed(entry.id);
      }
    });
  }

  private run(task: () => Promise<void> | void) {
    this.queue = this.queue.then(task).catch((err: Error) => this.handlers.onError(err));
  }

  private async processEnvelope(entry: UnprocessedEnvelope) {
    const envelope = fromBinary(EnvelopeSchema, entry.envelope);
    if (envelope.type === Envelope_Type.SERVER_DELIVERY_RECEIPT) {
      await this.handlers.onDeliveryReceipt(envelope);
      return;
    }

    if (entry.decrypted) {
      await this.handlers.onEnvelope({
        ...entry.decrypted,
        envelope,
        content: fromBinary(ContentSchema, entry.decrypted.content),
      });
      return;
    }

    let decrypted: DecryptedEnvelope;
    try {
      decrypted = await decryptEnvelope(this.store, this.account, envelope);
    } catch (err) {
      await this.handlers.onDecryptionError(envelope, err as Error);
      return;
    }

    const {
      senderServiceId, senderDeviceId, destinationServiceId, content, isSealedSender, groupId,
    } = decrypted;
    await this.store.addUnprocessed({
      ...entry,
      decrypted: {
        senderServiceId,
        senderDeviceId,
        destinationServiceId,
        content: toBinary(ContentSchema, content),
        isSealedSender,
        groupId,
      },
    });
    await this.handlers.onEnvelope(decrypted);
  }
}
