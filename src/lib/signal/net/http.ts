import { SIGNAL_USER_AGENT } from '../config';
import { pause } from '../../../util/schedulers';

import StreamReader from './StreamReader';
import TlsTunnel from './TlsTunnel';

type OnBodyProgress = (transferredLength: number, totalLength: number) => void;

export type HttpRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array;
  // Aborting closes the connection, and the request fails with the abort reason
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

// One idle keep-alive connection per host; requests that find it busy open another
const idleConnections = new Map<string, HttpConnection>();

export async function sendHttpRequest(host: string, request: HttpRequest): Promise<HttpResponse> {
  const idle = idleConnections.get(host);
  idleConnections.delete(host);

  if (idle?.tunnel.isOpen) {
    try {
      return await sendOnConnection(host, idle, request);
    } catch (err) {
      // The server may have closed the idle connection; retry once on a fresh one
      if (request.signal?.aborted) throw err;
    }
  }

  const tunnel = await TlsTunnel.open(host);
  const connection = { tunnel, reader: new StreamReader(() => tunnel.read()) };
  return sendOnConnection(host, connection, request);
}

async function sendOnConnection(host: string, connection: HttpConnection, request: HttpRequest) {
  const { tunnel } = connection;
  const { signal } = request;
  const close = () => tunnel.close();
  signal?.addEventListener('abort', close);
  try {
    signal?.throwIfAborted();
    const response = await exchange(host, connection, request);
    // Chunks that arrived before the abort can still complete the response
    signal?.throwIfAborted();
    return response;
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
  if (shouldClose || !tunnel.isOpen) {
    tunnel.close();
  } else {
    idleConnections.get(host)?.tunnel.close();
    idleConnections.set(host, connection);
  }
  return response;
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
