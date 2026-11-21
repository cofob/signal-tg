import type { SgxClientState } from '../wasm/generated/signal_wasm';
import type { Credentials } from './rest';

import { getServerTime } from '../../../util/serverTime';
import { wasm } from '../wasm';
import { getBasicAuthorization } from './rest';

import WebSocketClient from './WebSocketClient';

/** Verifies the enclave's attestation at `now` (milliseconds) and starts the handshake */
export type CreateEnclaveClient = (attestation: Uint8Array, now: number) => SgxClientState;

type Waiter = {
  resolve: (frame: Uint8Array | undefined) => void;
  reject: (error: Error) => void;
};

const CLOSE_NORMAL = 1000;
// libsignal-net `RECOMMENDED_WS_CONFIG` disconnects after this long without a frame from the enclave; its pings
// during a long lookup restart the wait
const RECEIVE_TIMEOUT_MS = 30000;
const MILLISECONDS_IN_SECOND = 1000;

/** The enclave closed the connection; CDSI and SVR2 put the reason for a failed request in the close frame */
export class AttestedCloseError extends Error {
  constructor(readonly code: number, readonly reason: string) {
    super(`Enclave closed the connection with code ${code}${reason ? `: ${reason}` : ''}`);
  }
}

/**
 * A Noise session with an SGX enclave over a WebSocket, as libsignal-net `AttestedConnection`
 * (`rust/net/infra/src/ws/attested.rs`): the enclave sends its attestation, `createClient` verifies it, the
 * client answers with the handshake, and later binary messages carry encrypted payloads.
 */
export default class AttestedConnection {
  private frames: Uint8Array[] = [];

  private waiter?: Waiter;

  private closeError?: AttestedCloseError;

  private client?: SgxClientState;

  private timeout?: ReturnType<typeof setTimeout>;

  private constructor(private socket: WebSocketClient) {
    socket.onMessage = (frame) => this.handleFrame(frame);
    socket.onClose = (code, reason) => this.handleClose(code, reason);
    socket.onActivity = () => {
      if (this.waiter) this.startTimeout();
    };
  }

  static async connect(host: string, path: string, credentials: Credentials, createClient: CreateEnclaveClient) {
    const socket = await WebSocketClient.connect(host, path, { Authorization: getBasicAuthorization(credentials) });
    const connection = new AttestedConnection(socket);
    try {
      const attestation = await connection.receiveFrame();
      if (!attestation) throw new AttestedCloseError(CLOSE_NORMAL, 'Closed before the attestation');
      const client = createClient(attestation, getServerTime() * MILLISECONDS_IN_SECOND);
      connection.client = client;
      socket.send(wasm.SgxClientState_InitialRequest(client));

      const handshake = await connection.receiveFrame();
      if (!handshake) throw new AttestedCloseError(CLOSE_NORMAL, 'Closed before the handshake');
      wasm.SgxClientState_CompleteHandshake(client, handshake);
    } catch (err) {
      connection.close();
      throw err;
    }
    return connection;
  }

  send(plaintext: Uint8Array) {
    this.socket.send(wasm.SgxClientState_EstablishedSend(this.client!, plaintext));
  }

  /** The next decrypted message, or `undefined` when the enclave closed the connection normally */
  async receive() {
    const frame = await this.receiveFrame();
    return frame && wasm.SgxClientState_EstablishedRecv(this.client!, frame);
  }

  close() {
    this.socket.close();
    this.client?.free();
    this.client = undefined;
  }

  private receiveFrame() {
    const frame = this.frames.shift();
    if (frame) return Promise.resolve(frame);
    if (this.closeError) {
      return this.closeError.code === CLOSE_NORMAL ? Promise.resolve(undefined) : Promise.reject(this.closeError);
    }

    return new Promise<Uint8Array | undefined>((resolve, reject) => {
      this.waiter = {
        resolve: (received) => {
          clearTimeout(this.timeout);
          resolve(received);
        },
        reject: (error) => {
          clearTimeout(this.timeout);
          reject(error);
        },
      };
      this.startTimeout();
    });
  }

  private startTimeout() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      const { waiter } = this;
      this.waiter = undefined;
      waiter?.reject(new Error('The enclave did not respond'));
      this.close();
    }, RECEIVE_TIMEOUT_MS);
  }

  private handleFrame(frame: Uint8Array) {
    const { waiter } = this;
    this.waiter = undefined;
    if (waiter) waiter.resolve(frame);
    else this.frames.push(frame);
  }

  private handleClose(code: number, reason: string) {
    this.closeError = new AttestedCloseError(code, reason);
    const { waiter } = this;
    this.waiter = undefined;
    if (!waiter) return;
    if (code === CLOSE_NORMAL) waiter.resolve(undefined);
    else waiter.reject(this.closeError);
  }
}
