import { Channel, invoke } from '@tauri-apps/api/core';

import type { NativeTransportEvent, NativeTransportRequest } from '../../lib/signal/net/NativeTransport';

type Connection = {
  /** The desktop app's ID, once `signal_connect` resolves */
  nativeId?: number;
  sendQueue: ArrayBuffer[];
  isSending?: boolean;
  isClosed?: boolean;
};

type ChannelMessage = ArrayBuffer | { closed: string };

// Names the connection of `signal_send`, whose body holds the raw bytes (`tauri/src/transport.rs`)
const CONNECTION_HEADER = 'signal-connection';

/**
 * Serves the engine's native transport (`src/lib/signal/net/NativeTransport.ts`) from the page: Tauri's `invoke` and
 * `Channel` exist only on the page, not in the worker. Sends run one at a time per connection, which keeps their
 * order, and each resolves once the app queued the bytes. Returns a function that closes the connections when the
 * worker stops.
 */
export default function serveNativeTransport(port: MessagePort) {
  const connections = new Map<number, Connection>();

  port.onmessage = ({ data: request }: MessageEvent<NativeTransportRequest>) => {
    switch (request.type) {
      case 'connect': {
        const connection: Connection = { sendQueue: [] };
        connections.set(request.id, connection);
        void connect(request.id, request.host, connection);
        break;
      }
      case 'send': {
        const connection = connections.get(request.id);
        if (!connection) return;
        connection.sendQueue.push(request.data);
        void flushSendQueue(request.id, connection);
        break;
      }
      case 'ack': {
        const nativeId = connections.get(request.id)?.nativeId;
        if (nativeId === undefined) return;
        invoke('signal_ack', { id: nativeId, byteLength: request.byteLength }).catch(() => undefined);
        break;
      }
      case 'close':
        closeConnection(request.id);
        break;
    }
  };

  return () => {
    port.close();
    [...connections.keys()].forEach(closeConnection);
  };

  async function connect(id: number, host: string, connection: Connection) {
    const onEvent = new Channel<ChannelMessage>((message) => {
      if (message instanceof ArrayBuffer) {
        postEvent({ type: 'data', id, data: message }, [message]);
      } else {
        reportClosed(id, message.closed);
      }
    });

    try {
      connection.nativeId = await invoke<number>('signal_connect', { host, onEvent });
    } catch (err) {
      reportClosed(id, String(err));
      return;
    }

    if (connection.isClosed) {
      invoke('signal_close', { id: connection.nativeId }).catch(() => undefined);
      return;
    }
    postEvent({ type: 'open', id });
    void flushSendQueue(id, connection);
  }

  async function flushSendQueue(id: number, connection: Connection) {
    if (connection.isSending || connection.nativeId === undefined) return;
    connection.isSending = true;

    while (connection.sendQueue.length && !connection.isClosed) {
      const data = connection.sendQueue.shift()!;
      try {
        await invoke('signal_send', data, { headers: { [CONNECTION_HEADER]: String(connection.nativeId) } });
      } catch (err) {
        reportClosed(id, String(err));
        break;
      }
      postEvent({ type: 'sent', id, byteLength: data.byteLength });
    }

    connection.isSending = false;
  }

  /** Closes a connection at the worker's request; the worker expects no events for it */
  function closeConnection(id: number) {
    const connection = connections.get(id);
    if (!connection) return;
    connections.delete(id);
    connection.isClosed = true;
    if (connection.nativeId !== undefined) {
      invoke('signal_close', { id: connection.nativeId }).catch(() => undefined);
    }
  }

  /** Tells the worker that a connection ended on the app's side */
  function reportClosed(id: number, reason: string) {
    const connection = connections.get(id);
    if (!connection) return;
    connections.delete(id);
    connection.isClosed = true;
    postEvent({ type: 'closed', id, reason });
  }

  function postEvent(event: NativeTransportEvent, transfer?: Transferable[]) {
    port.postMessage(event, transfer ?? []);
  }
}
