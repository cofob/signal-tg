import { SIGNAL_USER_AGENT } from '../config';
import { pause } from '../../../util/schedulers';

import Http2Connection, { Http2Error } from './Http2Connection';
import StreamReader from './StreamReader';
import TlsTunnel from './TlsTunnel';

type OnBodyProgress = (transferredLength: number, totalLength: number) => void;

export type HttpRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array;
  // Aborting closes the HTTP/1.1 connection or resets the HTTP/2 stream; the request fails with the abort reason
  signal?: AbortSignal;
  // Progress of the request body, and of a response body with `Content-Length`
  onSendProgress?: OnBodyProgress;
  onReceiveProgress?: OnBodyProgress;
};

export type HttpResponse = {
  status: number;
  headers: Map<string, string>;
  body: Uint8Array;
};

type HttpConnection = {
  tunnel: TlsTunnel;
  reader: StreamReader;
};

const CRLF = new Uint8Array([13, 10]);
const HEADERS_END = new Uint8Array([13, 10, 13, 10]);
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_MODIFIED = 304;
const CHUNK_SIZE_RADIX = 16;
const BODY_WRITE_SIZE = 64 * 1024;
const MAX_BUFFERED_AMOUNT = 1024 * 1024;
const DRAIN_CHECK_INTERVAL_MS = 20;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type HostPool = {
  idle: { connection: HttpConnection; timer: ReturnType<typeof setTimeout> }[];
  // Connections in use plus connections being opened
  activeCount: number;
  waiters: ((connection: HttpConnection | undefined) => void)[];
};

// Parallel requests share one HTTP/2 connection per host, or a few HTTP/1.1 keep-alive connections on hosts
// without HTTP/2, instead of opening a tunnel each
const MAX_CONNECTIONS_PER_HOST = 4;
const IDLE_TIMEOUT_MS = 60 * 1000;
const HTTP_ALPN_PROTOCOLS = ['h2', 'http/1.1'];
const HTTP2_ALPN_PROTOCOL = 'h2';

const pools = new Map<string, HostPool>();
const http2Connections = new Map<string, Http2Connection>();
const http2Opens = new Map<string, Promise<Http2Connection | undefined>>();
// Hosts that did not negotiate HTTP/2
const http1Hosts = new Set<string>();

export async function sendHttpRequest(host: string, request: HttpRequest): Promise<HttpResponse> {
  if (!http1Hosts.has(host)) {
    const response = await sendHttp2Request(host, request);
    if (response) return response;
  }
  return sendHttp1Request(host, request);
}

/** Sends the request as a stream of the host's HTTP/2 connection; resolves with `undefined` if it has none */
async function sendHttp2Request(host: string, request: HttpRequest): Promise<HttpResponse | undefined> {
  let canRetry = true;
  for (;;) {
    const existing = http2Connections.get(host);
    const isReused = Boolean(existing?.canOpenStreams);
    const connection = isReused ? existing : await openHttp2Connection(host);
    if (!connection) return undefined;
    try {
      return await connection.request(request);
    } catch (err) {
      // Streams the server did not process can be retried on a new connection, and so can requests other than
      // POST on a reused connection that closed, like on HTTP/1.1
      const isRetryable = err instanceof Http2Error
        && (err.isUnprocessed || (isReused && !connection.isOpen && request.method !== 'POST'));
      if (!canRetry || !isRetryable || request.signal?.aborted) throw err;
      canRetry = false;
    }
  }
}

/** Opens one connection per host at a time; a host without HTTP/2 gets the tunnel as an idle HTTP/1.1 connection */
function openHttp2Connection(host: string) {
  let opening = http2Opens.get(host);
  if (opening) return opening;

  opening = TlsTunnel.open(host, HTTP_ALPN_PROTOCOLS).then((tunnel) => {
    if (tunnel.alpnProtocol !== HTTP2_ALPN_PROTOCOL) {
      http1Hosts.add(host);
      const pool = getPool(host);
      pool.activeCount++;
      releaseConnection(pool, { tunnel, reader: new StreamReader(() => tunnel.read()) });
      return undefined;
    }
    const connection = new Http2Connection(tunnel, host, IDLE_TIMEOUT_MS);
    connection.onClose = () => {
      if (http2Connections.get(host) === connection) http2Connections.delete(host);
    };
    http2Connections.set(host, connection);
    return connection;
  }).finally(() => {
    http2Opens.delete(host);
  });
  http2Opens.set(host, opening);
  return opening;
}

async function sendHttp1Request(host: string, request: HttpRequest): Promise<HttpResponse> {
  const pool = getPool(host);
  let connection = await acquireConnection(pool);
  const isReused = Boolean(connection);

  // The server may close a keep-alive connection while it is idle: a request on a reused connection gets one
  // more try on a fresh one, unless it is a POST that the server may have received
  let canRetry = isReused && request.method !== 'POST';
  for (;;) {
    connection ??= await openConnection(pool, host);
    try {
      const { response, isReusable } = await sendOnConnection(host, connection, request);
      releaseConnection(pool, isReusable ? connection : undefined);
      return response;
    } catch (err) {
      if (!canRetry || request.signal?.aborted) {
        releaseConnection(pool, undefined);
        throw err;
      }
      // The slot stays reserved for the fresh connection
      canRetry = false;
      connection = undefined;
    }
  }
}

function getPool(host: string) {
  let pool = pools.get(host);
  if (!pool) {
    pool = { idle: [], activeCount: 0, waiters: [] };
    pools.set(host, pool);
  }
  return pool;
}

/** Takes an idle connection, or reserves a slot for a new one (`undefined`), waiting when the host is at its limit */
function acquireConnection(pool: HostPool): Promise<HttpConnection | undefined> {
  while (pool.idle.length) {
    const { connection, timer } = pool.idle.pop()!;
    clearTimeout(timer);
    if (connection.tunnel.isOpen) {
      pool.activeCount++;
      return Promise.resolve(connection);
    }
  }
  if (pool.activeCount < MAX_CONNECTIONS_PER_HOST) {
    pool.activeCount++;
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    pool.waiters.push(resolve);
  });
}

async function openConnection(pool: HostPool, host: string): Promise<HttpConnection> {
  try {
    const tunnel = await TlsTunnel.open(host);
    return { tunnel, reader: new StreamReader(() => tunnel.read()) };
  } catch (err) {
    releaseConnection(pool, undefined);
    throw err;
  }
}

/** Returns a slot: a reusable connection goes to the next waiter or the idle list; otherwise the slot frees up */
function releaseConnection(pool: HostPool, connection: HttpConnection | undefined) {
  const waiter = pool.waiters.shift();
  if (waiter) {
    // The slot moves to the waiter; without a connection it opens a new one
    waiter(connection?.tunnel.isOpen ? connection : undefined);
    return;
  }

  pool.activeCount--;
  if (!connection?.tunnel.isOpen) return;
  const entry = {
    connection,
    timer: setTimeout(() => {
      pool.idle = pool.idle.filter((idle) => idle !== entry);
      connection.tunnel.close();
    }, IDLE_TIMEOUT_MS),
  };
  pool.idle.push(entry);
}

/** Closes idle connections, for example after the tunnel address changed */
export function closeIdleConnections() {
  for (const connection of http2Connections.values()) connection.closeIfIdle();
  for (const pool of pools.values()) {
    for (const { connection, timer } of pool.idle) {
      clearTimeout(timer);
      connection.tunnel.close();
    }
    pool.idle = [];
  }
}

async function sendOnConnection(host: string, connection: HttpConnection, request: HttpRequest) {
  const { tunnel } = connection;
  const { signal } = request;
  const close = () => tunnel.close();
  signal?.addEventListener('abort', close);
  try {
    signal?.throwIfAborted();
    const result = await exchange(host, connection, request);
    // Chunks that arrived before the abort can still complete the response
    signal?.throwIfAborted();
    return result;
  } catch (err) {
    // A partly read response leaves the connection unusable
    tunnel.close();
    throw signal?.aborted ? signal.reason : err;
  } finally {
    signal?.removeEventListener('abort', close);
  }
}

async function exchange(host: string, connection: HttpConnection, request: HttpRequest) {
  const { tunnel, reader } = connection;
  const headers: Record<string, string> = {
    Host: host,
    'User-Agent': SIGNAL_USER_AGENT,
    Connection: 'keep-alive',
    ...request.headers,
  };
  if (request.body || request.method !== 'GET') {
    headers['Content-Length'] = String(request.body?.length ?? 0);
  }

  const head = [
    `${request.method} ${request.path} HTTP/1.1`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    '',
  ].join('\r\n');
  tunnel.write(textEncoder.encode(head));
  if (request.body?.length) await writeBody(tunnel, request.body, request.onSendProgress);

  const response = await readResponse(reader, request.method, request.onReceiveProgress);
  const shouldClose = response.headers.get('connection')?.toLowerCase() === 'close';
  if (shouldClose) tunnel.close();
  return { response, isReusable: !shouldClose && tunnel.isOpen };
}

/** Writes the body in parts as the socket drains, so memory stays flat and progress follows the network */
async function writeBody(tunnel: TlsTunnel, body: Uint8Array, onProgress?: OnBodyProgress) {
  for (let offset = 0; offset < body.length; offset += BODY_WRITE_SIZE) {
    tunnel.write(body.subarray(offset, offset + BODY_WRITE_SIZE));
    while (tunnel.isOpen && tunnel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      await pause(DRAIN_CHECK_INTERVAL_MS);
    }
    onProgress?.(Math.min(offset + BODY_WRITE_SIZE, body.length), body.length);
  }
}

async function readResponse(
  reader: StreamReader, method: string, onProgress?: OnBodyProgress,
): Promise<HttpResponse> {
  const head = textDecoder.decode(await reader.readUntil(HEADERS_END)).split('\r\n');
  const status = Number(head[0].split(' ')[1]);
  const headers = new Map<string, string>();
  for (const line of head.slice(1)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }
  }

  let body: Uint8Array;
  if (method === 'HEAD' || status === HTTP_NO_CONTENT || status === HTTP_NOT_MODIFIED) {
    body = new Uint8Array(0);
  } else if (headers.get('transfer-encoding')?.toLowerCase().includes('chunked')) {
    body = await readChunkedBody(reader);
  } else if (headers.has('content-length')) {
    const length = Number(headers.get('content-length'));
    body = await reader.readExactly(length, onProgress && ((readLength) => onProgress(readLength, length)));
  } else {
    headers.set('connection', 'close');
    body = await reader.readToEnd();
  }

  return { status, headers, body };
}

async function readChunkedBody(reader: StreamReader) {
  const chunks: Uint8Array[] = [];
  for (;;) {
    const sizeLine = textDecoder.decode(await reader.readUntil(CRLF));
    const size = parseInt(sizeLine.split(';')[0], CHUNK_SIZE_RADIX);
    if (!size) {
      // Trailer section ends with an empty line
      while ((await reader.readUntil(CRLF)).length) {
        // Skip trailers
      }
      break;
    }
    chunks.push(await reader.readExactly(size));
    await reader.readUntil(CRLF);
  }

  const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}
