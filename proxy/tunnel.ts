/**
 * WebSocket-to-TCP tunnel for TeleSignal.
 *
 * The browser opens `GET /tunnel?host=<host>&port=<port>` as a WebSocket and runs TLS itself, so this
 * process relays encrypted bytes to allowlisted Signal hosts without seeing their contents.
 *
 * Environment:
 * - `PORT` (default 8787) and `HOST` (default 127.0.0.1) to listen on.
 * - `ALLOWED_ORIGINS`: comma-separated origins allowed to open tunnels; unset allows any origin.
 * - `UPSTREAM_PROXY`: optional `http://host:port` HTTP CONNECT proxy for outbound connections.
 * - `MAX_TUNNELS` (default 64): concurrent tunnel limit.
 *
 * Run with Node 24: `node proxy/tunnel.ts`.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const ALLOWED_TARGETS = new Set([
  'chat.signal.org:443',
  'storage.signal.org:443',
  'cdn.signal.org:443',
  'cdn2.signal.org:443',
  'cdn3.signal.org:443',
  'cdsi.signal.org:443',
  'contentproxy.signal.org:443',
  'sfu.voip.signal.org:443',
]);
const DEFAULT_PORT = 8787;
const DEFAULT_MAX_TUNNELS = 64;
const MAX_FRAME_PAYLOAD = 16 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 15000;

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

const CLOSE_NORMAL = 1000;
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_TOO_BIG = 1009;
const CLOSE_UPSTREAM_FAILED = 1011;

const port = Number(process.env.PORT) || DEFAULT_PORT;
const host = process.env.HOST || '127.0.0.1';
const maxTunnels = Number(process.env.MAX_TUNNELS) || DEFAULT_MAX_TUNNELS;
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? new Set(process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()))
  : undefined;
const upstreamProxy = process.env.UPSTREAM_PROXY ? new URL(process.env.UPSTREAM_PROXY) : undefined;

let openTunnels = 0;

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  res.writeHead(404).end();
});

server.on('upgrade', (req, socket, head) => {
  handleUpgrade(req, socket, head);
});

server.listen(port, host, () => {
  log(`listening on ${host}:${port}`);
});

function handleUpgrade(req: IncomingMessage, client: Duplex, head: Buffer) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const target = `${url.searchParams.get('host')}:${url.searchParams.get('port')}`;
  const key = req.headers['sec-websocket-key'];

  if (url.pathname !== '/tunnel' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
    rejectUpgrade(client, 400, 'Bad Request');
    return;
  }
  if (allowedOrigins && !allowedOrigins.has(req.headers.origin ?? '')) {
    rejectUpgrade(client, 403, 'Forbidden');
    return;
  }
  if (!ALLOWED_TARGETS.has(target)) {
    rejectUpgrade(client, 403, 'Forbidden');
    return;
  }
  if (openTunnels >= maxTunnels) {
    rejectUpgrade(client, 503, 'Service Unavailable');
    return;
  }

  openTunnels++;
  client.once('close', () => {
    openTunnels--;
  });

  openUpstream(url.searchParams.get('host')!, Number(url.searchParams.get('port')))
    .then((upstream) => {
      const accept = createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64');
      client.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'));
      log(`tunnel open to ${target} (${openTunnels} open)`);
      relay(client, upstream, target, head);
    })
    .catch((err: Error) => {
      log(`tunnel to ${target} failed: ${err.message}`);
      rejectUpgrade(client, 502, 'Bad Gateway');
    });
}

function rejectUpgrade(client: Duplex, status: number, reason: string) {
  client.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function openUpstream(targetHost: string, targetPort: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = upstreamProxy
      ? connect(Number(upstreamProxy.port), upstreamProxy.hostname)
      : connect(targetPort, targetHost);
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error('connect timeout')));
    socket.once('error', reject);

    socket.once('connect', () => {
      if (!upstreamProxy) {
        socket.setTimeout(0);
        socket.removeListener('error', reject);
        resolve(socket);
        return;
      }

      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
      let response = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        response = Buffer.concat([response, chunk]);
        const headerEnd = response.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        socket.removeListener('data', onData);
        const statusLine = response.subarray(0, response.indexOf('\r\n')).toString();
        if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
          socket.destroy();
          reject(new Error(`upstream proxy refused: ${statusLine}`));
          return;
        }
        const rest = response.subarray(headerEnd + 4);
        if (rest.length) socket.unshift(rest);
        socket.setTimeout(0);
        socket.removeListener('error', reject);
        resolve(socket);
      };
      socket.on('data', onData);
    });
  });
}

function relay(client: Duplex, upstream: Socket, target: string, head: Buffer) {
  // Frames the client sent together with the upgrade request
  let buffer = Buffer.from(head);
  let isClosed = false;

  function close(code: number) {
    if (isClosed) return;
    isClosed = true;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    client.end(encodeFrame(OPCODE_CLOSE, payload));
    upstream.end();
    log(`tunnel to ${target} closed (${code})`);
  }

  upstream.on('data', (chunk: Buffer) => {
    if (!client.write(encodeFrame(OPCODE_BINARY, chunk))) {
      upstream.pause();
      client.once('drain', () => upstream.resume());
    }
  });
  upstream.on('end', () => close(CLOSE_NORMAL));
  upstream.on('error', () => close(CLOSE_UPSTREAM_FAILED));

  client.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (!isClosed) {
      const frame = decodeFrame(buffer);
      if (!frame) break;
      if (frame === 'tooBig') {
        close(CLOSE_TOO_BIG);
        break;
      }
      buffer = buffer.subarray(frame.length);

      switch (frame.opcode) {
        case OPCODE_BINARY:
        case OPCODE_CONTINUATION:
          if (!upstream.write(frame.payload)) {
            client.pause();
            upstream.once('drain', () => client.resume());
          }
          break;
        case OPCODE_PING:
          client.write(encodeFrame(OPCODE_PONG, frame.payload));
          break;
        case OPCODE_PONG:
          break;
        case OPCODE_CLOSE:
          close(CLOSE_NORMAL);
          break;
        case OPCODE_TEXT:
          close(CLOSE_UNSUPPORTED_DATA);
          break;
        default:
          close(CLOSE_PROTOCOL_ERROR);
      }
    }
  });
  client.on('end', () => close(CLOSE_NORMAL));
  client.on('error', () => close(CLOSE_NORMAL));
}

type Frame = { opcode: number; payload: Buffer; length: number };

/** Decodes one masked client frame from the start of `data`, or returns `undefined` if it is incomplete */
function decodeFrame(data: Buffer): Frame | 'tooBig' | undefined {
  if (data.length < 2) return undefined;

  const opcode = data[0] & 0x0f;
  const isMasked = (data[1] & 0x80) !== 0;
  let payloadLength = data[1] & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (data.length < offset + 2) return undefined;
    payloadLength = data.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (data.length < offset + 8) return undefined;
    const bigLength = data.readBigUInt64BE(offset);
    if (bigLength > BigInt(MAX_FRAME_PAYLOAD)) return 'tooBig';
    payloadLength = Number(bigLength);
    offset += 8;
  }
  if (payloadLength > MAX_FRAME_PAYLOAD) return 'tooBig';

  const maskLength = isMasked ? 4 : 0;
  if (data.length < offset + maskLength + payloadLength) return undefined;

  const payload = Buffer.from(data.subarray(offset + maskLength, offset + maskLength + payloadLength));
  if (isMasked) {
    const mask = data.subarray(offset, offset + 4);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload, length: offset + maskLength + payloadLength };
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length < 0x10000) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function log(message: string) {
  // eslint-disable-next-line no-console
  console.log(`[tunnel] ${new Date().toISOString()} ${message}`);
}
