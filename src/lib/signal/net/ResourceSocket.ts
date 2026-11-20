import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import { WebSocketMessage_Type, WebSocketMessageSchema } from '../proto/generated/WebSocketResources_pb';
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
const DEFAULT_KEEPALIVE_PATH = '/v1/keepalive';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Signal's request/response protocol over a WebSocket (`WebSocketResources.proto`), used by the
 * chat and provisioning sockets.
 */
export default class ResourceSocket {
  // Requests that arrive before a handler is set wait for it: the provisioning socket gets its address
  // right after connecting, before the caller can set `onRequest`
  private requestHandler?: (request: IncomingRequest) => void;

  private earlyRequests: IncomingRequest[] = [];

  set onRequest(handler: ((request: IncomingRequest) => void) | undefined) {
    this.requestHandler = handler;
    if (!handler) return;
    const requests = this.earlyRequests;
    this.earlyRequests = [];
    requests.forEach((request) => handler(request));
  }

  onClose?: (code: number, reason: string) => void;

  private nextId = BigInt(Date.now());

  private pending = new Map<bigint, PendingRequest>();

  private keepaliveTimer?: ReturnType<typeof setInterval>;

  private isClosed = false;

  constructor(private socket: WebSocketClient, private keepalivePath = DEFAULT_KEEPALIVE_PATH) {
    socket.onMessage = (data) => this.handleMessage(data);
    socket.onClose = (code, reason) => this.handleClose(code, reason);
    this.keepaliveTimer = setInterval(() => this.sendKeepalive(), KEEPALIVE_INTERVAL_MS);
  }

  static async connect(host: string, path: string, headers?: Record<string, string>, keepalivePath?: string) {
    return new ResourceSocket(await WebSocketClient.connect(host, path, headers), keepalivePath);
  }

  sendRequest({
    verb, path, headers = {}, body, timeout = REQUEST_TIMEOUT_MS,
  }: ResourceRequest): Promise<ResourceResponse> {
    if (this.isClosed) return Promise.reject(new Error('Socket is closed'));

    const id = this.nextId++;
    this.socket.send(toBinary(WebSocketMessageSchema, create(WebSocketMessageSchema, {
      type: WebSocketMessage_Type.REQUEST,
      request: {
        id,
        verb,
        path,
        body,
        headers: Object.entries(headers).map(([name, value]) => `${name}:${value}`),
      },
    })));

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

  /** Sends a request with an optional JSON body; a JSON response body is parsed */
  async sendJsonRequest<T>(verb: string, path: string, json?: unknown, headers?: Record<string, string>) {
    const response = await this.sendRequest({
      verb,
      path,
      headers: json !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: json !== undefined ? textEncoder.encode(JSON.stringify(json)) : undefined,
    });
    return { status: response.status, json: parseJson<T>(response.body) };
  }

  close(code?: number, reason?: string) {
    this.socket.close(code, reason);
  }

  private handleMessage(data: Uint8Array) {
    const message = fromBinary(WebSocketMessageSchema, data);

    if (message.type === WebSocketMessage_Type.RESPONSE && message.response) {
      const {
        id, status, message: statusMessage, headers, body,
      } = message.response;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      pending.resolve({
        status, message: statusMessage, headers: parseHeaders(headers), body: body.length ? body : undefined,
      });
      return;
    }

    if (message.type === WebSocketMessage_Type.REQUEST && message.request) {
      const {
        id, verb, path, headers, body,
      } = message.request;
      let hasResponded = false;
      this.dispatchRequest({
        verb,
        path,
        headers: parseHeaders(headers),
        body: body.length ? body : undefined,
        respond: (status, statusMessage) => {
          if (hasResponded || this.isClosed) return;
          hasResponded = true;
          this.socket.send(toBinary(WebSocketMessageSchema, create(WebSocketMessageSchema, {
            type: WebSocketMessage_Type.RESPONSE,
            response: { id, status, message: statusMessage },
          })));
        },
      });
    }
  }

  private dispatchRequest(request: IncomingRequest) {
    if (this.requestHandler) {
      this.requestHandler(request);
    } else {
      this.earlyRequests.push(request);
    }
  }

  private async sendKeepalive() {
    try {
      await this.sendRequest({ verb: 'GET', path: this.keepalivePath, timeout: KEEPALIVE_TIMEOUT_MS });
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

// Error responses may carry plain text
export function parseJson<T>(body?: Uint8Array) {
  if (!body) return undefined;
  try {
    return JSON.parse(textDecoder.decode(body)) as T;
  } catch {
    return undefined;
  }
}

function parseHeaders(headers: string[]) {
  const result = new Map<string, string>();
  for (const header of headers) {
    const separator = header.indexOf(':');
    if (separator > 0) {
      result.set(header.slice(0, separator).trim().toLowerCase(), header.slice(separator + 1).trim());
    }
  }
  return result;
}
