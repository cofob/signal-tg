import type { TrafficClass } from '../config';

import { DEBUG } from '../../../config';
import { SIGNAL_USER_AGENT } from '../config';

import NetworkError from './NetworkError';
import StreamReader from './StreamReader';
import TlsTunnel from './TlsTunnel';

type CloseHandler = (code: number, reason: string) => void;

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HEADERS_END = new Uint8Array([13, 10, 13, 10]);
const HTTP_SWITCHING_PROTOCOLS = 101;
const KEY_LENGTH = 16;
const MASK_LENGTH = 4;
const MAX_SHORT_LENGTH = 125;
const EXTENDED_16_BIT_LENGTH = 126;
const EXTENDED_64_BIT_LENGTH = 127;
const MAX_16_BIT_LENGTH = 0xffff;

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

const CLOSE_NORMAL = 1000;
const CLOSE_ABNORMAL = 1006;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * WebSocket client over a `TlsTunnel`. Browsers' `WebSocket` cannot set request headers or trust
 * Signal's certificate authority, so the framing runs here.
 */
export default class WebSocketClient {
  // Messages that arrive before a handler is set wait for it, so none are lost right after connecting
  private messageHandler?: (data: Uint8Array) => void;

  private earlyMessages: Uint8Array[] = [];

  set onMessage(handler: ((data: Uint8Array) => void) | undefined) {
    this.messageHandler = handler;
    if (!handler) return;
    const messages = this.earlyMessages;
    this.earlyMessages = [];
    messages.forEach((message) => handler(message));
  }

  // A close before the handler is set reaches it once it is set
  private closeHandler?: CloseHandler;

  private closeEvent?: { code: number; reason: string };

  set onClose(handler: CloseHandler | undefined) {
    this.closeHandler = handler;
    const { closeEvent } = this;
    if (!handler || !closeEvent) return;
    this.closeEvent = undefined;
    handler(closeEvent.code, closeEvent.reason);
  }

  // Every frame from the server, pings included: a sign of life while a reply takes long
  onActivity?: NoneToVoidFunction;

  private isClosed = false;

  private constructor(private tunnel: TlsTunnel, private reader: StreamReader) {}

  static async connect(host: string, path: string, trafficClass: TrafficClass, headers: Record<string, string> = {}) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.debug('[signal] Connect WebSocket', trafficClass, host, path);
    }
    const tunnel = await TlsTunnel.open(host, trafficClass);
    const reader = new StreamReader(() => tunnel.read());
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(KEY_LENGTH))));

    const request = [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      `User-Agent: ${SIGNAL_USER_AGENT}`,
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      '',
      '',
    ].join('\r\n');
    tunnel.write(textEncoder.encode(request));

    const responseHead = textDecoder.decode(await reader.readUntil(HEADERS_END)).split('\r\n');
    const status = Number(responseHead[0].split(' ')[1]);
    if (status !== HTTP_SWITCHING_PROTOCOLS) {
      tunnel.close();
      throw new WebSocketConnectError(status);
    }

    const acceptHeader = responseHead.find((line) => line.toLowerCase().startsWith('sec-websocket-accept:'));
    const expectedAccept = await computeAccept(key);
    if (acceptHeader?.slice(acceptHeader.indexOf(':') + 1).trim() !== expectedAccept) {
      tunnel.close();
      throw new NetworkError('WebSocket handshake failed: invalid Sec-WebSocket-Accept');
    }

    const client = new WebSocketClient(tunnel, reader);
    void client.readLoop();
    return client;
  }

  send(data: Uint8Array) {
    this.writeFrame(OPCODE_BINARY, data);
  }

  close(code = CLOSE_NORMAL, reason = '') {
    if (this.isClosed) return;
    const reasonBytes = textEncoder.encode(reason);
    const payload = new Uint8Array(2 + reasonBytes.length);
    new DataView(payload.buffer).setUint16(0, code);
    payload.set(reasonBytes, 2);
    try {
      this.writeFrame(OPCODE_CLOSE, payload);
    } catch {
      // The tunnel may already be closed
    }
    this.finish(code, reason);
  }

  private async readLoop() {
    let fragments: Uint8Array[] = [];
    try {
      while (!this.isClosed) {
        const header = await this.reader.readExactly(2);
        const isFinal = (header[0] & 0x80) !== 0;
        const opcode = header[0] & 0x0f;
        let length = header[1] & 0x7f;
        if (length === EXTENDED_16_BIT_LENGTH) {
          const extended = await this.reader.readExactly(2);
          length = new DataView(extended.buffer).getUint16(0);
        } else if (length === EXTENDED_64_BIT_LENGTH) {
          const extended = await this.reader.readExactly(8);
          length = Number(new DataView(extended.buffer).getBigUint64(0));
        }
        const payload = length ? await this.reader.readExactly(length) : new Uint8Array(0);
        this.onActivity?.();

        switch (opcode) {
          case OPCODE_TEXT:
          case OPCODE_BINARY:
          case OPCODE_CONTINUATION:
            fragments.push(payload);
            if (isFinal) {
              const message = concatBytes(fragments);
              fragments = [];
              if (this.messageHandler) {
                this.messageHandler(message);
              } else {
                this.earlyMessages.push(message);
              }
            }
            break;
          case OPCODE_PING:
            this.writeFrame(OPCODE_PONG, payload);
            break;
          case OPCODE_CLOSE: {
            const code = payload.length >= 2 ? new DataView(payload.buffer).getUint16(0) : CLOSE_NORMAL;
            this.close(code, textDecoder.decode(payload.subarray(2)));
            break;
          }
          default:
            break;
        }
      }
    } catch (err) {
      this.finish(CLOSE_ABNORMAL, (err as Error).message);
    }
  }

  private writeFrame(opcode: number, payload: Uint8Array) {
    let headerLength = 2;
    if (payload.length > MAX_16_BIT_LENGTH) headerLength += 8;
    else if (payload.length > MAX_SHORT_LENGTH) headerLength += 2;

    const frame = new Uint8Array(headerLength + MASK_LENGTH + payload.length);
    const view = new DataView(frame.buffer);
    frame[0] = 0x80 | opcode;
    if (payload.length > MAX_16_BIT_LENGTH) {
      frame[1] = 0x80 | EXTENDED_64_BIT_LENGTH;
      view.setBigUint64(2, BigInt(payload.length));
    } else if (payload.length > MAX_SHORT_LENGTH) {
      frame[1] = 0x80 | EXTENDED_16_BIT_LENGTH;
      view.setUint16(2, payload.length);
    } else {
      frame[1] = 0x80 | payload.length;
    }

    const mask = crypto.getRandomValues(new Uint8Array(MASK_LENGTH));
    frame.set(mask, headerLength);
    const offset = headerLength + MASK_LENGTH;
    for (let i = 0; i < payload.length; i++) {
      frame[offset + i] = payload[i] ^ mask[i % MASK_LENGTH];
    }
    this.tunnel.write(frame);
  }

  private finish(code: number, reason: string) {
    if (this.isClosed) return;
    this.isClosed = true;
    this.tunnel.close();
    if (this.closeHandler) {
      this.closeHandler(code, reason);
    } else {
      this.closeEvent = { code, reason };
    }
  }
}

export class WebSocketConnectError extends NetworkError {
  constructor(readonly status: number) {
    super(`WebSocket handshake failed with HTTP ${status}`);
  }
}

async function computeAccept(key: string) {
  const digest = await crypto.subtle.digest('SHA-1', textEncoder.encode(key + WEBSOCKET_GUID));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function concatBytes(chunks: Uint8Array[]) {
  if (chunks.length === 1) return chunks[0];
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
