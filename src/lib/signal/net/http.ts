import { SIGNAL_USER_AGENT } from '../config';

import StreamReader from './StreamReader';
import TlsTunnel from './TlsTunnel';

export type HttpRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: Uint8Array;
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
    } catch {
      // The server may have closed the idle connection; retry once on a fresh one
    }
  }

  const tunnel = await TlsTunnel.open(host);
  const connection = { tunnel, reader: new StreamReader(() => tunnel.read()) };
  return sendOnConnection(host, connection, request);
}

/** Closes the idle keep-alive connections, so the next requests open new ones through the current tunnel */
export function closeIdleHttpConnections() {
  idleConnections.forEach(({ tunnel }) => tunnel.close());
  idleConnections.clear();
}

async function sendOnConnection(host: string, connection: HttpConnection, request: HttpRequest) {
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
  if (request.body?.length) tunnel.write(request.body);

  const response = await readResponse(reader, request.method);
  const shouldClose = response.headers.get('connection')?.toLowerCase() === 'close';
  if (shouldClose || !tunnel.isOpen) {
    tunnel.close();
  } else {
    idleConnections.get(host)?.tunnel.close();
    idleConnections.set(host, connection);
  }
  return response;
}

async function readResponse(reader: StreamReader, method: string): Promise<HttpResponse> {
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
    body = await reader.readExactly(Number(headers.get('content-length')));
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
