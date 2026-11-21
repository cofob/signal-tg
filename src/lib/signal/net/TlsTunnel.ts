import type { TrafficClass } from '../config';

import { DEBUG } from '../../../config';
import { getSignalTunnelUrl, SIGNAL_CA_PEM } from '../config';
import { wasm } from '../wasm';

import NativeTransport, { hasNativeTransport } from './NativeTransport';
import NetworkError from './NetworkError';

const PORT = 443;
const TUNNEL_PATH = '/tunnel';
const MAX_MESSAGE_SIZE = 64 * 1024;
const DEFAULT_ALPN_PROTOCOLS = ['http/1.1'];
// A tunnel that accepts the WebSocket but never answers would otherwise leave every request to the host waiting
const HANDSHAKE_TIMEOUT_MS = 20 * 1000;

/** Carries a TLS connection's bytes to a Signal host */
export interface TunnelTransport {
  /** Bytes accepted but not sent to the network yet */
  readonly bufferedAmount: number;
  send(data: Uint8Array<ArrayBuffer>): void;
  close(): void;
}

export type TunnelTransportHandlers = {
  onOpen: NoneToVoidFunction;
  onData: (data: Uint8Array) => void;
  /** Called once, also when opening fails, unless `close` was called first */
  onClose: (reason?: string) => void;
};

let signalCaDer: Uint8Array | undefined;

/**
 * A TLS connection to a Signal host through the WebSocket-to-TCP tunnel (`proxy/`) or, in the desktop app, its native
 * transport. TLS runs in WebAssembly and trusts only Signal's certificate authority.
 */
export default class TlsTunnel {
  readonly host: string;

  /** The ALPN protocol the server chose, once the handshake completes */
  alpnProtocol?: string;

  /** The tunnel this connection runs through, `undefined` for the default one; it never changes */
  readonly tunnelUrl: string | undefined;

  private transport!: TunnelTransport;

  private tls: wasm.TlsClient;

  private chunks: Uint8Array[] = [];

  private pendingRead?: (chunk: Uint8Array | undefined) => void;

  private isTransportOpen = false;

  private isClosed = false;

  private closeError?: Error;

  private constructor(host: string, readonly trafficClass: TrafficClass, alpnProtocols: string[]) {
    this.host = host;
    this.tunnelUrl = getSignalTunnelUrl(trafficClass);
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.debug('[signal] Open tunnel', trafficClass, host, this.tunnelUrl ?? 'default');
    }
    this.tls = new wasm.TlsClient(host, [getSignalCaDer()], alpnProtocols);
  }

  /**
   * The class picks the tunnel. Each connection has its own TLS client and configuration, so nothing, such as a
   * session ticket, links one connection to another. `alpnProtocols` are offered in order of preference.
   */
  static open(host: string, trafficClass: TrafficClass, alpnProtocols = DEFAULT_ALPN_PROTOCOLS): Promise<TlsTunnel> {
    const tunnel = new TlsTunnel(host, trafficClass, alpnProtocols);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new NetworkError(`TLS handshake with ${host} timed out`);
        tunnel.transport.close();
        tunnel.fail(error);
        reject(error);
      }, HANDSHAKE_TIMEOUT_MS);

      tunnel.transport = openTransport(host, trafficClass, tunnel.tunnelUrl, {
        onOpen: () => {
          tunnel.isTransportOpen = true;
          tunnel.flush();
        },
        onData: (data) => {
          // Data can still arrive after `close` or a failure freed the TLS state
          if (!tunnel.isOpen) return;
          const wasHandshaking = tunnel.tls.isHandshaking();
          try {
            tunnel.receive(data);
          } catch (err) {
            clearTimeout(timeout);
            tunnel.fail(err as Error);
            reject(err);
            return;
          }
          if (wasHandshaking && !tunnel.tls.isHandshaking()) {
            clearTimeout(timeout);
            tunnel.alpnProtocol = tunnel.tls.alpnProtocol();
            resolve(tunnel);
          }
        },
        onClose: (reason) => {
          clearTimeout(timeout);
          const error = new NetworkError(`Tunnel to ${host} closed${reason ? `: ${reason}` : ''}`);
          tunnel.fail(error);
          reject(error);
        },
      });
    });
  }

  get isOpen() {
    return !this.isClosed;
  }

  /** Whether new requests of this class still go through this tunnel, which a proxy setting change ends */
  get isOnCurrentTunnel() {
    return this.tunnelUrl === getSignalTunnelUrl(this.trafficClass);
  }

  /** Bytes written to the tunnel but not sent to the network yet */
  get bufferedAmount() {
    return this.transport.bufferedAmount;
  }

  write(data: Uint8Array) {
    if (this.isClosed) throw this.closeError ?? new NetworkError(`Tunnel to ${this.host} is closed`);
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
      this.flush();
    } catch {
      // The connection may already be unusable
    }
    this.transport.close();
    this.fail(new NetworkError(`Tunnel to ${this.host} is closed`));
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
    if (this.isClosed || !this.isTransportOpen) return;
    // wasm-bindgen copies results into a fresh `ArrayBuffer`, but types them as `ArrayBufferLike`
    const outgoing = this.tls.takeOutgoing() as Uint8Array<ArrayBuffer>;
    if (outgoing.length) this.transport.send(outgoing);
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

/** The proxy settings pick a WebSocket tunnel; without one the desktop app connects natively */
function openTransport(
  host: string, trafficClass: TrafficClass, tunnelUrl: string | undefined, handlers: TunnelTransportHandlers,
): TunnelTransport {
  if (!tunnelUrl && hasNativeTransport()) return new NativeTransport(host, trafficClass, handlers);

  const url = new URL(tunnelUrl ?? getDefaultTunnelUrl());
  url.searchParams.set('host', host);
  url.searchParams.set('port', String(PORT));
  return new WebSocketTransport(url, handlers);
}

class WebSocketTransport implements TunnelTransport {
  private socket: WebSocket;

  constructor(url: URL, handlers: TunnelTransportHandlers) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = handlers.onOpen;
    this.socket.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      handlers.onData(new Uint8Array(e.data));
    };
    this.socket.onclose = () => {
      handlers.onClose();
    };
    this.socket.onerror = () => {
      // `onclose` follows with the details available to scripts
    };
  }

  get bufferedAmount() {
    return this.socket.bufferedAmount;
  }

  send(data: Uint8Array<ArrayBuffer>) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    // The tunnel limits message size, and large uploads produce one large TLS output
    for (let offset = 0; offset < data.length; offset += MAX_MESSAGE_SIZE) {
      this.socket.send(data.subarray(offset, offset + MAX_MESSAGE_SIZE));
    }
  }

  close() {
    this.socket.close();
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
