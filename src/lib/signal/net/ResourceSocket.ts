import type { WebSocketRequestMessage } from '../proto/generated/WebSocketResources';

import { WebSocketMessage, WebSocketMessage_Type } from '../proto/generated/WebSocketResources';
import WebSocketClient from './WebSocketClient';

export type ResourceRequest = {
  verb: string;
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array;
  timeout?: number;
};

export type ResourceResponse = {
  status: number;
  message?: string;
  headers: Map<string, string>;
  body?: Uint8Array;
};

/** A request pushed by the server; `respond` must be called once it is handled */
export type IncomingRequest = {
  verb: string;
  path: string;
  headers: Map<string, string>;
  body?: Uint8Array;
  respond(status: number, message: string): void;
};

type PendingRequest = {
  resolve: (response: ResourceResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 30000;
const KEEPALIVE_INTERVAL_MS = 30000;
const KEEPALIVE_TIMEOUT_MS = 15000;
const KEEPALIVE_PATH = '/v1/keepalive';

/**
 * Signal's request/response protocol over a WebSocket (`WebSocketResources.proto`), used by the
 * chat and provisioning sockets.
 */
export default class ResourceSocket {
  onRequest?: (request: IncomingRequest) => void;

  onClose?: (code: number, reason: string) => void;

  private nextId = BigInt(Date.now());

  private pending = new Map<bigint, PendingRequest>();

  private keepaliveTimer?: ReturnType<typeof setInterval>;

  private isClosed = false;

  constructor(private socket: WebSocketClient, private shouldKeepAlive = true) {
    socket.onMessage = (data) => this.handleMessage(data);
    socket.onClose = (code, reason) => this.handleClose(code, reason);
    if (shouldKeepAlive) {
      this.keepaliveTimer = setInterval(() => this.sendKeepalive(), KEEPALIVE_INTERVAL_MS);
    }
  }

  static async connect(host: string, path: string, headers?: Record<string, string>, shouldKeepAlive?: boolean) {
    return new ResourceSocket(await WebSocketClient.connect(host, path, headers), shouldKeepAlive);
  }

  sendRequest({
    verb, path, headers = {}, body, timeout = REQUEST_TIMEOUT_MS,
  }: ResourceRequest): Promise<ResourceResponse> {
    if (this.isClosed) return Promise.reject(new Error('Socket is closed'));

    const id = this.nextId++;
    const request: WebSocketRequestMessage = {
      id,
      verb,
      path,
      body,
      headers: Object.entries(headers).map(([name, value]) => `${name}:${value}`),
    };
    this.socket.send(WebSocketMessage.encode({ type: WebSocketMessage_Type.REQUEST, request }));

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Request ${verb} ${path} timed out`));
        }, timeout),
      });
    });
  }

  close(code?: number, reason?: string) {
    this.socket.close(code, reason);
  }

  private handleMessage(data: Uint8Array) {
    const message = WebSocketMessage.decode(data);

    if (message.type === WebSocketMessage_Type.RESPONSE && message.response) {
      const { id, status = 0, message: statusMessage, headers, body } = message.response;
      const pending = id !== undefined ? this.pending.get(id) : undefined;
      if (!pending) return;
      this.pending.delete(id!);
      clearTimeout(pending.timeout);
      pending.resolve({
        status, message: statusMessage, headers: parseHeaders(headers), body,
      });
      return;
    }

    if (message.type === WebSocketMessage_Type.REQUEST && message.request) {
      const {
        id, verb = '', path = '', headers, body,
      } = message.request;
      let hasResponded = false;
      this.onRequest?.({
        verb,
        path,
        headers: parseHeaders(headers),
        body,
        respond: (status, statusMessage) => {
          if (hasResponded || this.isClosed) return;
          hasResponded = true;
          this.socket.send(WebSocketMessage.encode({
            type: WebSocketMessage_Type.RESPONSE,
            response: { id, status, message: statusMessage },
          }));
        },
      });
    }
  }

  private async sendKeepalive() {
    try {
      await this.sendRequest({ verb: 'GET', path: KEEPALIVE_PATH, timeout: KEEPALIVE_TIMEOUT_MS });
    } catch {
      this.close(1000, 'Keepalive failed');
    }
  }

  private handleClose(code: number, reason: string) {
    if (this.isClosed) return;
    this.isClosed = true;
    clearInterval(this.keepaliveTimer);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Socket closed: ${code} ${reason}`));
    }
    this.pending.clear();
    this.onClose?.(code, reason);
  }
}

function parseHeaders(headers: string[] = []) {
  const result = new Map<string, string>();
  for (const header of headers) {
    const separator = header.indexOf(':');
    if (separator > 0) {
      result.set(header.slice(0, separator).trim().toLowerCase(), header.slice(separator + 1).trim());
    }
  }
  return result;
}
