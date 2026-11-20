import { SIGNAL_CA_PEM, SIGNAL_TUNNEL_URL } from '../config';
import { wasm } from '../wasm';

const DEFAULT_PORT = 443;
const TUNNEL_PATH = '/tunnel';

let signalCaDer: Uint8Array | undefined;

/**
 * A TLS connection to a Signal host through the WebSocket-to-TCP tunnel (`proxy/tunnel.ts`).
 * TLS runs in WebAssembly and trusts only Signal's certificate authority.
 */
export default class TlsTunnel {
  readonly host: string;

  private socket: WebSocket;

  private tls: wasm.TlsClient;

  private chunks: Uint8Array[] = [];

  private pendingRead?: (chunk: Uint8Array | undefined) => void;

  private isClosed = false;

  private closeError?: Error;

  private constructor(host: string, socket: WebSocket) {
    this.host = host;
    this.socket = socket;
    this.tls = new wasm.TlsClient(host, [getSignalCaDer()]);
  }

  static open(host: string, port = DEFAULT_PORT): Promise<TlsTunnel> {
    const url = new URL(SIGNAL_TUNNEL_URL ?? getDefaultTunnelUrl());
    url.searchParams.set('host', host);
    url.searchParams.set('port', String(port));

    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const tunnel = new TlsTunnel(host, socket);

    return new Promise((resolve, reject) => {
      socket.onopen = () => {
        tunnel.flush();
      };
      socket.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        // Data can still arrive after `close` or a failure freed the TLS state
        if (!tunnel.isOpen) return;
        const wasHandshaking = tunnel.tls.isHandshaking();
        try {
          tunnel.receive(new Uint8Array(e.data));
        } catch (err) {
          tunnel.fail(err as Error);
          reject(err);
          return;
        }
        if (wasHandshaking && !tunnel.tls.isHandshaking()) {
          resolve(tunnel);
        }
      };
      socket.onclose = () => {
        const error = new Error(`Tunnel to ${host} closed`);
        tunnel.fail(error);
        reject(error);
      };
      socket.onerror = () => {
        // `onclose` follows with the details available to scripts
      };
    });
  }

  get isOpen() {
    return !this.isClosed;
  }

  /** Bytes written to the tunnel but not sent to the network yet */
  get bufferedAmount() {
    return this.socket.bufferedAmount;
  }

  write(data: Uint8Array) {
    if (this.isClosed) throw this.closeError ?? new Error(`Tunnel to ${this.host} is closed`);
    this.tls.send(data);
    this.flush();
  }

  /** Resolves with the next decrypted chunk, or `undefined` once the connection is closed */
  read(): Promise<Uint8Array | undefined> {
    const chunk = this.chunks.shift();
    if (chunk) return Promise.resolve(chunk);
    if (this.isClosed) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      this.pendingRead = resolve;
    });
  }

  close() {
    if (this.isClosed) return;
    try {
      this.tls.close();
      const outgoing = this.tls.takeOutgoing() as Uint8Array<ArrayBuffer>;
      if (outgoing.length && this.socket.readyState === WebSocket.OPEN) this.socket.send(outgoing);
    } catch {
      // The connection may already be unusable
    }
    this.socket.close();
    this.fail(new Error(`Tunnel to ${this.host} is closed`));
  }

  private receive(data: Uint8Array) {
    const plaintext = this.tls.receive(data);
    this.flush();
    if (!plaintext.length) return;

    if (this.pendingRead) {
      const resolve = this.pendingRead;
      this.pendingRead = undefined;
      resolve(plaintext);
    } else {
      this.chunks.push(plaintext);
    }
  }

  private flush() {
    if (this.isClosed || this.socket.readyState !== WebSocket.OPEN) return;
    // wasm-bindgen copies results into a fresh `ArrayBuffer`, but types them as `ArrayBufferLike`
    const outgoing = this.tls.takeOutgoing() as Uint8Array<ArrayBuffer>;
    if (outgoing.length) this.socket.send(outgoing);
  }

  private fail(error: Error) {
    if (this.isClosed) return;
    this.isClosed = true;
    this.closeError = error;
    this.tls.free();
    if (this.pendingRead) {
      const resolve = this.pendingRead;
      this.pendingRead = undefined;
      resolve(undefined);
    }
  }
}

function getDefaultTunnelUrl() {
  const { protocol, host } = self.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}${TUNNEL_PATH}`;
}

function getSignalCaDer() {
  signalCaDer ??= decodePem(SIGNAL_CA_PEM);
  return signalCaDer;
}

function decodePem(pem: string) {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
