import type { TunnelTransport, TunnelTransportHandlers } from './TlsTunnel';

/** Messages from the engine's worker to the page, which calls the desktop app's commands (`tauri/src/transport.rs`) */
export type NativeTransportRequest =
  | { type: 'connect'; id: number; host: string }
  | { type: 'send'; id: number; data: ArrayBuffer }
  | { type: 'ack'; id: number; byteLength: number }
  | { type: 'close'; id: number };

/** Messages from the page to the worker */
export type NativeTransportEvent =
  | { type: 'open'; id: number }
  | { type: 'data'; id: number; data: ArrayBuffer }
  | { type: 'sent'; id: number; byteLength: number }
  | { type: 'closed'; id: number; reason: string };

// The desktop app accepts at most 64 KiB per send (`MAX_SEND_BYTES`)
const MAX_SEND_SIZE = 64 * 1024;
// Acknowledged in batches well below the app's 1 MiB receive window, so it never waits for an acknowledgment
const ACK_SIZE = 256 * 1024;

let port: MessagePort | undefined;
let nextId = 1;
const transports = new Map<number, NativeTransport>();

/** Receives the page's end of the bridge; only the desktop app's page sends one */
export function setNativeTransportPort(newPort: MessagePort) {
  port = newPort;
  port.onmessage = handleEvent;
}

export function hasNativeTransport() {
  return Boolean(port);
}

/**
 * A TCP connection that the desktop app opens to a Signal host. The worker cannot call Tauri, so requests go through
 * the page (`src/util/tauri/nativeTransport.ts`) on a `MessagePort`, and buffers move instead of being copied.
 */
export default class NativeTransport implements TunnelTransport {
  bufferedAmount = 0;

  private readonly id = nextId++;

  private unacknowledged = 0;

  constructor(host: string, private handlers: TunnelTransportHandlers) {
    transports.set(this.id, this);
    postRequest({ type: 'connect', id: this.id, host });
  }

  send(data: Uint8Array<ArrayBuffer>) {
    for (let offset = 0; offset < data.length; offset += MAX_SEND_SIZE) {
      const chunk = data.slice(offset, offset + MAX_SEND_SIZE).buffer;
      this.bufferedAmount += chunk.byteLength;
      postRequest({ type: 'send', id: this.id, data: chunk }, [chunk]);
    }
  }

  close() {
    if (!transports.delete(this.id)) return;
    postRequest({ type: 'close', id: this.id });
  }

  handleEvent(event: NativeTransportEvent) {
    switch (event.type) {
      case 'open':
        this.handlers.onOpen();
        break;
      case 'data':
        this.handlers.onData(new Uint8Array(event.data));
        this.acknowledge(event.data.byteLength);
        break;
      case 'sent':
        this.bufferedAmount -= event.byteLength;
        break;
      case 'closed':
        transports.delete(this.id);
        this.handlers.onClose(event.reason);
        break;
    }
  }

  private acknowledge(byteLength: number) {
    this.unacknowledged += byteLength;
    if (this.unacknowledged < ACK_SIZE) return;
    postRequest({ type: 'ack', id: this.id, byteLength: this.unacknowledged });
    this.unacknowledged = 0;
  }
}

function handleEvent(e: MessageEvent<NativeTransportEvent>) {
  transports.get(e.data.id)?.handleEvent(e.data);
}

function postRequest(request: NativeTransportRequest, transfer?: Transferable[]) {
  port!.postMessage(request, transfer ?? []);
}
