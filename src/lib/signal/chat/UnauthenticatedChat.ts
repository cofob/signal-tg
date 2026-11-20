import { SIGNAL_CHAT_HOST } from '../config';

import ResourceSocket from '../net/ResourceSocket';

const CHAT_PATH = '/v1/websocket/';

/**
 * The chat socket without account credentials, for requests that must not reveal the sender: sealed sender
 * sends and prekey fetches with access keys (Signal Desktop `SocketManager.getUnauthenticatedApi`).
 * It connects on first use and again after it closes.
 */
export default class UnauthenticatedChat {
  private socket?: Promise<ResourceSocket>;

  async sendJsonRequest<T>(verb: string, path: string, json?: unknown, headers?: Record<string, string>) {
    const socket = await this.getSocket();
    return socket.sendJsonRequest<T>(verb, path, json, headers);
  }

  close() {
    const socket = this.socket;
    this.socket = undefined;
    void socket?.then((connected) => connected.close(), () => undefined);
  }

  private getSocket() {
    if (this.socket) return this.socket;

    const socket = ResourceSocket.connect(SIGNAL_CHAT_HOST, CHAT_PATH).then((connected) => {
      connected.onClose = () => {
        if (this.socket === socket) this.socket = undefined;
      };
      return connected;
    });
    socket.catch(() => {
      if (this.socket === socket) this.socket = undefined;
    });
    this.socket = socket;
    return socket;
  }
}
