import type { HeaderField } from './hpack';
import type { HttpRequest, HttpResponse } from './http';
import type TlsTunnel from './TlsTunnel';

import { SIGNAL_USER_AGENT } from '../config';
import { pause } from '../../../util/schedulers';
import { encodeHeaders, HpackDecoder, HpackError } from './hpack';

import StreamReader from './StreamReader';

type Stream = {
  id: number;
  request: HttpRequest;
  // Bytes the peer lets us send, and bytes we let it send
  sendWindow: number;
  receiveWindow: number;
  // Received bytes not yet returned to the peer with `WINDOW_UPDATE`
  unannouncedLength: number;
  isRequestEnded?: boolean;
  status?: number;
  headers?: Map<string, string>;
  contentLength?: number;
  chunks: Uint8Array[];
  bodyLength: number;
  response: Promise<HttpResponse>;
  resolve: (response: HttpResponse) => void;
  reject: (error: Error) => void;
};

type HeaderBlock = {
  streamId: number;
  isEndStream: boolean;
  fragments: Uint8Array[];
  length: number;
};

// Frame types (RFC 9113 section 6)
const FRAME_DATA = 0x0;
const FRAME_HEADERS = 0x1;
const FRAME_RST_STREAM = 0x3;
const FRAME_SETTINGS = 0x4;
const FRAME_PUSH_PROMISE = 0x5;
const FRAME_PING = 0x6;
const FRAME_GO_AWAY = 0x7;
const FRAME_WINDOW_UPDATE = 0x8;
const FRAME_CONTINUATION = 0x9;

// Error codes (RFC 9113 section 7)
const ERROR_NONE = 0x0;
const ERROR_PROTOCOL = 0x1;
const ERROR_FLOW_CONTROL = 0x3;
const ERROR_FRAME_SIZE = 0x6;
const ERROR_REFUSED_STREAM = 0x7;
const ERROR_CANCEL = 0x8;
const ERROR_COMPRESSION = 0x9;
const ERROR_ENHANCE_YOUR_CALM = 0xb;

// Setting identifiers (RFC 9113 section 6.5.2)
const SETTING_ENABLE_PUSH = 0x2;
const SETTING_MAX_CONCURRENT_STREAMS = 0x3;
const SETTING_INITIAL_WINDOW_SIZE = 0x4;
const SETTING_MAX_FRAME_SIZE = 0x5;
const SETTING_MAX_HEADER_LIST_SIZE = 0x6;

const FLAG_END_STREAM = 0x1;
const FLAG_ACK = 0x1;
const FLAG_END_HEADERS = 0x4;
const FLAG_PADDED = 0x8;
const FLAG_PRIORITY = 0x20;

const CONNECTION_PREFACE = new TextEncoder().encode('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');
const FRAME_HEADER_LENGTH = 9;
const SETTING_LENGTH = 6;
const PING_LENGTH = 8;
const RST_STREAM_LENGTH = 4;
const WINDOW_UPDATE_LENGTH = 4;
const GOAWAY_MIN_LENGTH = 8;
const PRIORITY_FIELDS_LENGTH = 5;
const STREAM_ID_MASK = 0x7fffffff;
const MAX_STREAM_ID = 2 ** 31 - 1;
const MAX_WINDOW_SIZE = 2 ** 31 - 1;
const DEFAULT_WINDOW_SIZE = 65535;
const DEFAULT_MAX_FRAME_SIZE = 16384;
const MAX_ALLOWED_FRAME_SIZE = 2 ** 24 - 1;
// RFC 9113 section 5.1.2 recommends at least 100; the peer's `SETTINGS` replaces this
const INITIAL_MAX_CONCURRENT_STREAMS = 100;

// Windows we grant; received data is consumed into the response body right away
const STREAM_WINDOW_SIZE = 1024 * 1024;
const CONNECTION_WINDOW_SIZE = 4 * 1024 * 1024;
// Received frames are at most `DEFAULT_MAX_FRAME_SIZE`, and a header block at most `MAX_HEADER_LIST_SIZE`
// in at most `MAX_HEADER_BLOCK_FRAMES` frames
const MAX_HEADER_LIST_SIZE = 64 * 1024;
const MAX_HEADER_BLOCK_FRAMES = 64;
// Control frames are not answered while this much is waiting to be sent
const MAX_CONTROL_BACKLOG = 4 * 1024 * 1024;

const BODY_WRITE_SIZE = 64 * 1024;
const MAX_BUFFERED_AMOUNT = 1024 * 1024;
const DRAIN_CHECK_INTERVAL_MS = 20;

const HTTP_INFORMATIONAL_MIN = 100;
const HTTP_INFORMATIONAL_MAX = 199;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_MODIFIED = 304;

// Hop-by-hop headers have no meaning in HTTP/2 (RFC 9113 section 8.2.2); `Host` becomes `:authority`
const OMITTED_REQUEST_HEADERS = new Set(['connection', 'host', 'keep-alive', 'proxy-connection', 'te',
  'transfer-encoding', 'upgrade']);

const EMPTY_BYTES = new Uint8Array(0);

/** A request failure; `isUnprocessed` means the server did not act on it, so it can be retried */
export class Http2Error extends Error {
  constructor(message: string, readonly isUnprocessed?: boolean) {
    super(message);
  }
}

class ConnectionError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/**
 * An HTTP/2 client connection (RFC 9113) over a `TlsTunnel` that negotiated `h2`. Requests run as
 * parallel streams; the connection closes after `idleTimeoutMs` without streams.
 */
export default class Http2Connection {
  onClose?: NoneToVoidFunction;

  private reader: StreamReader;

  private decoder = new HpackDecoder();

  private streams = new Map<number, Stream>();

  private nextStreamId = 1;

  private sendWindow = DEFAULT_WINDOW_SIZE;

  private receiveWindow = CONNECTION_WINDOW_SIZE;

  private unannouncedLength = 0;

  private peerInitialWindowSize = DEFAULT_WINDOW_SIZE;

  private peerMaxFrameSize = DEFAULT_MAX_FRAME_SIZE;

  private maxConcurrentStreams = INITIAL_MAX_CONCURRENT_STREAMS;

  private hasReceivedSettings = false;

  private headerBlock?: HeaderBlock;

  private goAwayLastStreamId?: number;

  private isClosed = false;

  // Set when new requests must go elsewhere; the connection closes once its streams finish
  private isRetired = false;

  private idleTimer?: ReturnType<typeof setTimeout>;

  // Wake requests that wait for a stream slot or a send window
  private waiters = new Set<NoneToVoidFunction>();

  constructor(private tunnel: TlsTunnel, private host: string, private idleTimeoutMs: number) {
    this.reader = new StreamReader(() => tunnel.read());

    const settings = new Uint8Array(SETTING_LENGTH * 3);
    const view = new DataView(settings.buffer);
    [
      [SETTING_ENABLE_PUSH, 0],
      [SETTING_INITIAL_WINDOW_SIZE, STREAM_WINDOW_SIZE],
      [SETTING_MAX_HEADER_LIST_SIZE, MAX_HEADER_LIST_SIZE],
    ].forEach(([id, value], i) => {
      view.setUint16(i * SETTING_LENGTH, id);
      view.setUint32(i * SETTING_LENGTH + 2, value);
    });
    tunnel.write(concatBytes([
      CONNECTION_PREFACE,
      encodeFrame(FRAME_SETTINGS, 0, 0, settings),
      encodeWindowUpdate(0, CONNECTION_WINDOW_SIZE - DEFAULT_WINDOW_SIZE),
    ]));

    this.startIdleTimer();
    void this.readLoop();
  }

  /** Whether new requests can use this connection */
  get canOpenStreams() {
    return !this.isClosed && !this.isRetired
      && this.goAwayLastStreamId === undefined && this.nextStreamId <= MAX_STREAM_ID;
  }

  /** Whether new requests of the connection's class still go through its tunnel */
  get isOnCurrentTunnel() {
    return this.tunnel.isOnCurrentTunnel;
  }

  /** Stops new requests; streams in flight finish, and the connection closes after the last one */
  retire() {
    this.isRetired = true;
    this.closeIfIdle();
  }

  get isOpen() {
    return !this.isClosed;
  }

  /** Sends a request as a new stream; it waits while the peer's stream limit is reached */
  async request(request: HttpRequest): Promise<HttpResponse> {
    const { signal } = request;
    for (;;) {
      signal?.throwIfAborted();
      if (!this.canOpenStreams) throw new Http2Error(`Connection to ${this.host} is closing`, true);
      if (this.streams.size < this.maxConcurrentStreams) break;
      await this.waitForChange(signal);
    }

    const stream = this.openStream(request);
    const cancel = () => this.resetStream(stream, ERROR_CANCEL, signal!.reason);
    signal?.addEventListener('abort', cancel);
    try {
      this.writeHeaders(stream);
      if (request.body?.length) await this.writeBody(stream, request.body);
    } catch (err) {
      // Writes fail only once the tunnel is closed
      this.close(err as Error);
    }
    try {
      return await stream.response;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  /** Closes the connection if no requests use it */
  closeIfIdle() {
    if (!this.streams.size) this.closeGracefully();
  }

  private openStream(request: HttpRequest) {
    const id = this.nextStreamId;
    this.nextStreamId += 2;
    clearTimeout(this.idleTimer);

    let resolve!: Stream['resolve'];
    let reject!: Stream['reject'];
    const response = new Promise<HttpResponse>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    // The stream can fail while its body is sent, before `request` awaits the response
    response.catch(() => undefined);

    const stream: Stream = {
      id,
      request,
      sendWindow: this.peerInitialWindowSize,
      receiveWindow: STREAM_WINDOW_SIZE,
      unannouncedLength: 0,
      isRequestEnded: !request.body?.length,
      chunks: [],
      bodyLength: 0,
      response,
      resolve,
      reject,
    };
    this.streams.set(id, stream);
    return stream;
  }

  private writeHeaders(stream: Stream) {
    const { request } = stream;
    const headers: Record<string, string> = { 'user-agent': SIGNAL_USER_AGENT };
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      const lowerName = name.toLowerCase();
      if (!OMITTED_REQUEST_HEADERS.has(lowerName)) headers[lowerName] = value;
    }
    if (request.body || request.method !== 'GET') headers['content-length'] = String(request.body?.length ?? 0);
    const block = encodeHeaders([
      [':method', request.method],
      [':scheme', 'https'],
      [':authority', this.host],
      [':path', request.path],
      ...Object.entries(headers),
    ]);

    // `END_STREAM` goes on `HEADERS`, `END_HEADERS` on the last frame of the block
    const frames: Uint8Array[] = [];
    for (let offset = 0; offset < block.length || !frames.length; offset += this.peerMaxFrameSize) {
      const end = Math.min(offset + this.peerMaxFrameSize, block.length);
      const isFirst = !frames.length;
      const flags = (isFirst && stream.isRequestEnded ? FLAG_END_STREAM : 0)
        | (end === block.length ? FLAG_END_HEADERS : 0);
      frames.push(encodeFrame(
        isFirst ? FRAME_HEADERS : FRAME_CONTINUATION, flags, stream.id, block.subarray(offset, end),
      ));
    }
    this.tunnel.write(concatBytes(frames));
  }

  /** Sends the body within the peer's flow control windows, as the socket drains */
  private async writeBody(stream: Stream, body: Uint8Array) {
    const { onSendProgress } = stream.request;
    let offset = 0;
    while (offset < body.length) {
      if (this.streams.get(stream.id) !== stream) return;
      const length = Math.min(body.length - offset, stream.sendWindow, this.sendWindow, BODY_WRITE_SIZE);
      if (length <= 0) {
        await this.waitForChange(stream.request.signal);
        continue;
      }

      const end = offset + length;
      const frames: Uint8Array[] = [];
      for (let frameOffset = offset; frameOffset < end; frameOffset += this.peerMaxFrameSize) {
        const frameEnd = Math.min(frameOffset + this.peerMaxFrameSize, end);
        const flags = frameEnd === body.length ? FLAG_END_STREAM : 0;
        frames.push(encodeFrame(FRAME_DATA, flags, stream.id, body.subarray(frameOffset, frameEnd)));
      }
      stream.sendWindow -= length;
      this.sendWindow -= length;
      offset = end;
      stream.isRequestEnded = offset === body.length;
      this.tunnel.write(concatBytes(frames));

      while (this.tunnel.isOpen && this.tunnel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        await pause(DRAIN_CHECK_INTERVAL_MS);
      }
      onSendProgress?.(offset, body.length);
    }
  }

  private async readLoop() {
    try {
      for (;;) {
        const header = await this.reader.readExactly(FRAME_HEADER_LENGTH);
        const length = (header[0] << 16) | (header[1] << 8) | header[2];
        const type = header[3];
        const flags = header[4];
        const streamId = readUint32(header, 5) & STREAM_ID_MASK;
        // `SETTINGS_MAX_FRAME_SIZE` keeps its default, so frames are small
        if (length > DEFAULT_MAX_FRAME_SIZE) throw new ConnectionError(ERROR_FRAME_SIZE, 'Frame is too large');
        const payload = length ? await this.reader.readExactly(length) : EMPTY_BYTES;
        this.handleFrame(type, flags, streamId, payload);
        if (this.isClosed) return;
      }
    } catch (err) {
      if (err instanceof ConnectionError) this.sendGoAway(err.code);
      this.close(err as Error);
    }
  }

  private handleFrame(type: number, flags: number, streamId: number, payload: Uint8Array) {
    // A header block is contiguous (RFC 9113 section 6.10), and the server preface starts with `SETTINGS`
    if (this.headerBlock && type !== FRAME_CONTINUATION) {
      throw new ConnectionError(ERROR_PROTOCOL, 'Header block interrupted');
    }
    if (!this.hasReceivedSettings && type !== FRAME_SETTINGS) {
      throw new ConnectionError(ERROR_PROTOCOL, 'Server preface is not SETTINGS');
    }

    switch (type) {
      case FRAME_DATA:
        this.handleData(flags, streamId, payload);
        break;
      case FRAME_HEADERS:
        this.handleHeaders(flags, streamId, payload);
        break;
      case FRAME_CONTINUATION:
        this.handleContinuation(flags, streamId, payload);
        break;
      case FRAME_RST_STREAM:
        this.handleRstStream(streamId, payload);
        break;
      case FRAME_SETTINGS:
        this.handleSettings(flags, streamId, payload);
        break;
      case FRAME_PING:
        if (streamId) throw new ConnectionError(ERROR_PROTOCOL, 'PING on a stream');
        if (payload.length !== PING_LENGTH) throw new ConnectionError(ERROR_FRAME_SIZE, 'Invalid PING');
        if (!(flags & FLAG_ACK)) this.writeControlFrame(encodeFrame(FRAME_PING, FLAG_ACK, 0, payload));
        break;
      case FRAME_GO_AWAY:
        this.handleGoAway(streamId, payload);
        break;
      case FRAME_WINDOW_UPDATE:
        this.handleWindowUpdate(streamId, payload);
        break;
      case FRAME_PUSH_PROMISE:
        throw new ConnectionError(ERROR_PROTOCOL, 'Push is disabled');
      default:
        // `PRIORITY` is advisory, and unknown frame types are ignored (RFC 9113 section 5.5)
        break;
    }
  }

  private handleData(flags: number, streamId: number, payload: Uint8Array) {
    if (!streamId) throw new ConnectionError(ERROR_PROTOCOL, 'DATA on stream 0');
    // Flow control counts the whole payload, padding included
    this.receiveWindow -= payload.length;
    if (this.receiveWindow < 0) throw new ConnectionError(ERROR_FLOW_CONTROL, 'Connection window exceeded');
    const data = removePadding(flags, payload);
    const stream = this.getStream(streamId);
    this.consumeConnectionWindow(payload.length);
    if (!stream) return;

    stream.receiveWindow -= payload.length;
    if (stream.receiveWindow < 0) {
      this.resetStream(stream, ERROR_FLOW_CONTROL, new Http2Error('Stream window exceeded'));
      return;
    }
    if (stream.status === undefined || (data.length && hasNoBody(stream))) {
      this.resetStream(stream, ERROR_PROTOCOL, new Http2Error('Unexpected DATA'));
      return;
    }
    if (data.length) {
      stream.chunks.push(data);
      stream.bodyLength += data.length;
      if (stream.contentLength !== undefined && stream.bodyLength > stream.contentLength) {
        this.resetStream(stream, ERROR_PROTOCOL, new Http2Error('Body exceeds Content-Length'));
        return;
      }
      if (stream.contentLength !== undefined) {
        // The callback may abort the request
        stream.request.onReceiveProgress?.(stream.bodyLength, stream.contentLength);
        if (this.streams.get(streamId) !== stream) return;
      }
    }

    if (flags & FLAG_END_STREAM) {
      this.completeStream(stream);
      return;
    }
    stream.unannouncedLength += payload.length;
    if (stream.unannouncedLength >= STREAM_WINDOW_SIZE / 2) {
      stream.receiveWindow += stream.unannouncedLength;
      this.tunnel.write(encodeWindowUpdate(streamId, stream.unannouncedLength));
      stream.unannouncedLength = 0;
    }
  }

  private consumeConnectionWindow(length: number) {
    this.unannouncedLength += length;
    if (this.unannouncedLength < CONNECTION_WINDOW_SIZE / 2) return;
    this.receiveWindow += this.unannouncedLength;
    this.tunnel.write(encodeWindowUpdate(0, this.unannouncedLength));
    this.unannouncedLength = 0;
  }

  private handleHeaders(flags: number, streamId: number, payload: Uint8Array) {
    if (!streamId) throw new ConnectionError(ERROR_PROTOCOL, 'HEADERS on stream 0');
    let fragment = removePadding(flags, payload);
    if (flags & FLAG_PRIORITY) {
      if (fragment.length < PRIORITY_FIELDS_LENGTH) throw new ConnectionError(ERROR_FRAME_SIZE, 'Short HEADERS');
      fragment = fragment.subarray(PRIORITY_FIELDS_LENGTH);
    }
    this.headerBlock = {
      streamId, isEndStream: Boolean(flags & FLAG_END_STREAM), fragments: [fragment], length: fragment.length,
    };
    if (flags & FLAG_END_HEADERS) this.finishHeaderBlock();
  }

  private handleContinuation(flags: number, streamId: number, payload: Uint8Array) {
    const block = this.headerBlock;
    if (!block || block.streamId !== streamId) {
      throw new ConnectionError(ERROR_PROTOCOL, 'Unexpected CONTINUATION');
    }
    block.fragments.push(payload);
    block.length += payload.length;
    if (block.length > MAX_HEADER_LIST_SIZE || block.fragments.length > MAX_HEADER_BLOCK_FRAMES) {
      throw new ConnectionError(ERROR_ENHANCE_YOUR_CALM, 'Header block is too large');
    }
    if (flags & FLAG_END_HEADERS) this.finishHeaderBlock();
  }

  private finishHeaderBlock() {
    const { streamId, isEndStream, fragments } = this.headerBlock!;
    this.headerBlock = undefined;
    // Every block is decoded, even for closed streams, to keep the dynamic table in sync
    let fields: HeaderField[];
    try {
      fields = this.decoder.decode(concatBytes(fragments), MAX_HEADER_LIST_SIZE);
    } catch (err) {
      if (err instanceof HpackError) throw new ConnectionError(ERROR_COMPRESSION, err.message);
      throw err;
    }
    const stream = this.getStream(streamId);
    if (!stream) return;

    if (stream.status !== undefined) {
      // Trailers end the stream and carry no pseudo-headers; their fields are not used
      if (!isEndStream || fields.some(([name]) => name.startsWith(':'))) {
        this.resetStream(stream, ERROR_PROTOCOL, new Http2Error('Malformed trailers'));
        return;
      }
      this.completeStream(stream);
      return;
    }

    const response = parseResponseHeaders(fields);
    if (!response || (isEndStream && response.status <= HTTP_INFORMATIONAL_MAX)) {
      this.resetStream(stream, ERROR_PROTOCOL, new Http2Error('Malformed response headers'));
      return;
    }
    // Informational responses precede the final one
    if (response.status <= HTTP_INFORMATIONAL_MAX) return;

    stream.status = response.status;
    stream.headers = response.headers;
    const contentLength = response.headers.get('content-length');
    if (contentLength !== undefined) {
      if (!/^\d+$/.test(contentLength)) {
        this.resetStream(stream, ERROR_PROTOCOL, new Http2Error('Invalid Content-Length'));
        return;
      }
      stream.contentLength = Number(contentLength);
    }
    if (isEndStream) this.completeStream(stream);
  }

  private completeStream(stream: Stream) {
    if (!hasNoBody(stream) && stream.contentLength !== undefined && stream.bodyLength !== stream.contentLength) {
      this.resetStream(stream, ERROR_PROTOCOL, new Http2Error('Body is shorter than Content-Length'));
      return;
    }
    // The response can complete before the request body is sent; the rest is not needed
    this.removeStream(stream, stream.isRequestEnded ? undefined : ERROR_NONE);
    stream.resolve({ status: stream.status!, headers: stream.headers!, body: concatBytes(stream.chunks) });
  }

  private handleRstStream(streamId: number, payload: Uint8Array) {
    if (!streamId) throw new ConnectionError(ERROR_PROTOCOL, 'RST_STREAM on stream 0');
    if (payload.length !== RST_STREAM_LENGTH) throw new ConnectionError(ERROR_FRAME_SIZE, 'Invalid RST_STREAM');
    const stream = this.getStream(streamId);
    if (!stream) return;
    const code = readUint32(payload, 0);
    this.removeStream(stream);
    stream.reject(new Http2Error(`Stream reset with error ${code}`, code === ERROR_REFUSED_STREAM));
  }

  private handleSettings(flags: number, streamId: number, payload: Uint8Array) {
    if (streamId) throw new ConnectionError(ERROR_PROTOCOL, 'SETTINGS on a stream');
    if (flags & FLAG_ACK) {
      if (payload.length) throw new ConnectionError(ERROR_FRAME_SIZE, 'SETTINGS ACK with payload');
      return;
    }
    if (payload.length % SETTING_LENGTH) throw new ConnectionError(ERROR_FRAME_SIZE, 'Invalid SETTINGS');

    for (let offset = 0; offset < payload.length; offset += SETTING_LENGTH) {
      const id = (payload[offset] << 8) | payload[offset + 1];
      const value = readUint32(payload, offset + 2);
      switch (id) {
        case SETTING_ENABLE_PUSH:
          if (value) throw new ConnectionError(ERROR_PROTOCOL, 'Server enabled push');
          break;
        case SETTING_MAX_CONCURRENT_STREAMS:
          this.maxConcurrentStreams = value;
          break;
        case SETTING_INITIAL_WINDOW_SIZE: {
          if (value > MAX_WINDOW_SIZE) throw new ConnectionError(ERROR_FLOW_CONTROL, 'Invalid window size');
          // The change applies to the windows of open streams (RFC 9113 section 6.9.2)
          const delta = value - this.peerInitialWindowSize;
          this.peerInitialWindowSize = value;
          for (const stream of this.streams.values()) {
            stream.sendWindow += delta;
            if (stream.sendWindow > MAX_WINDOW_SIZE) {
              throw new ConnectionError(ERROR_FLOW_CONTROL, 'Stream window overflow');
            }
          }
          break;
        }
        case SETTING_MAX_FRAME_SIZE:
          if (value < DEFAULT_MAX_FRAME_SIZE || value > MAX_ALLOWED_FRAME_SIZE) {
            throw new ConnectionError(ERROR_PROTOCOL, 'Invalid frame size');
          }
          this.peerMaxFrameSize = value;
          break;
        default:
          // `HEADER_TABLE_SIZE` does not matter to an encoder without indexing; `MAX_HEADER_LIST_SIZE` is
          // advisory, and unknown settings are ignored
          break;
      }
    }
    this.hasReceivedSettings = true;
    this.writeControlFrame(encodeFrame(FRAME_SETTINGS, FLAG_ACK, 0, EMPTY_BYTES));
    this.notify();
  }

  private handleGoAway(streamId: number, payload: Uint8Array) {
    if (streamId) throw new ConnectionError(ERROR_PROTOCOL, 'GOAWAY on a stream');
    if (payload.length < GOAWAY_MIN_LENGTH) throw new ConnectionError(ERROR_FRAME_SIZE, 'Invalid GOAWAY');
    const lastStreamId = readUint32(payload, 0) & STREAM_ID_MASK;
    const code = readUint32(payload, 4);
    this.goAwayLastStreamId = Math.min(this.goAwayLastStreamId ?? lastStreamId, lastStreamId);

    // Streams after the last one were not processed, so they can be retried (RFC 9113 section 6.8)
    for (const stream of [...this.streams.values()]) {
      if (stream.id > this.goAwayLastStreamId) {
        this.removeStream(stream);
        stream.reject(new Http2Error(`Connection to ${this.host} went away with error ${code}`, true));
      }
    }
    this.notify();
    if (!this.streams.size) this.closeGracefully();
  }

  private handleWindowUpdate(streamId: number, payload: Uint8Array) {
    if (payload.length !== WINDOW_UPDATE_LENGTH) {
      throw new ConnectionError(ERROR_FRAME_SIZE, 'Invalid WINDOW_UPDATE');
    }
    const increment = readUint32(payload, 0) & STREAM_ID_MASK;
    if (!streamId) {
      if (!increment) throw new ConnectionError(ERROR_PROTOCOL, 'Zero window increment');
      this.sendWindow += increment;
      if (this.sendWindow > MAX_WINDOW_SIZE) throw new ConnectionError(ERROR_FLOW_CONTROL, 'Window overflow');
    } else {
      const stream = this.getStream(streamId);
      if (!stream) return;
      stream.sendWindow += increment;
      if (!increment || stream.sendWindow > MAX_WINDOW_SIZE) {
        this.resetStream(stream, increment ? ERROR_FLOW_CONTROL : ERROR_PROTOCOL,
          new Http2Error('Invalid stream window update'));
        return;
      }
    }
    this.notify();
  }

  /** Returns an open stream, or `undefined` for a closed one; frames on idle streams are protocol errors */
  private getStream(streamId: number) {
    if (streamId % 2 === 0 || streamId >= this.nextStreamId) {
      throw new ConnectionError(ERROR_PROTOCOL, `Frame on idle stream ${streamId}`);
    }
    return this.streams.get(streamId);
  }

  private resetStream(stream: Stream, code: number, error: Error) {
    if (this.streams.get(stream.id) !== stream) return;
    this.removeStream(stream, code);
    stream.reject(error);
  }

  /** Forgets a stream, sending `RST_STREAM` with `resetCode` if given */
  private removeStream(stream: Stream, resetCode?: number) {
    this.streams.delete(stream.id);
    if (resetCode !== undefined && this.tunnel.isOpen) {
      const payload = new Uint8Array(RST_STREAM_LENGTH);
      new DataView(payload.buffer).setUint32(0, resetCode);
      this.tunnel.write(encodeFrame(FRAME_RST_STREAM, 0, stream.id, payload));
    }
    this.notify();
    if (this.streams.size) return;
    if (this.goAwayLastStreamId !== undefined || this.isRetired) {
      this.closeGracefully();
    } else {
      this.startIdleTimer();
    }
  }

  private writeControlFrame(frame: Uint8Array) {
    // A peer that sends control frames faster than they drain could grow the send buffer without bound
    if (this.tunnel.bufferedAmount > MAX_CONTROL_BACKLOG) {
      throw new ConnectionError(ERROR_ENHANCE_YOUR_CALM, 'Too many control frames');
    }
    this.tunnel.write(frame);
  }

  private startIdleTimer() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.closeGracefully(), this.idleTimeoutMs);
  }

  private closeGracefully() {
    this.sendGoAway(ERROR_NONE);
    this.close(new Http2Error(`Connection to ${this.host} is closed`));
  }

  private sendGoAway(code: number) {
    if (!this.tunnel.isOpen) return;
    // No server-initiated streams are accepted, so the last stream is 0
    const payload = new Uint8Array(GOAWAY_MIN_LENGTH);
    new DataView(payload.buffer).setUint32(4, code);
    try {
      this.tunnel.write(encodeFrame(FRAME_GO_AWAY, 0, 0, payload));
    } catch {
      // The connection is closing anyway
    }
  }

  private close(error: Error) {
    if (this.isClosed) return;
    this.isClosed = true;
    clearTimeout(this.idleTimer);
    this.tunnel.close();
    const streams = [...this.streams.values()];
    this.streams.clear();
    for (const stream of streams) {
      stream.reject(error instanceof Http2Error ? error : new Http2Error(error.message));
    }
    this.notify();
    this.onClose?.();
  }

  private waitForChange(signal?: AbortSignal) {
    return new Promise<void>((resolve) => {
      const wake = () => {
        this.waiters.delete(wake);
        signal?.removeEventListener('abort', wake);
        resolve();
      };
      this.waiters.add(wake);
      signal?.addEventListener('abort', wake);
    });
  }

  private notify() {
    for (const wake of [...this.waiters]) wake();
  }
}

function parseResponseHeaders(fields: HeaderField[]) {
  let status: number | undefined;
  const headers = new Map<string, string>();
  for (const [name, value] of fields) {
    if (name.startsWith(':')) {
      // `:status` is the only response pseudo-header, and it comes first (RFC 9113 section 8.3)
      if (name !== ':status' || status !== undefined || headers.size || !/^\d{3}$/.test(value)) return undefined;
      status = Number(value);
    } else {
      if (name !== name.toLowerCase()) return undefined;
      headers.set(name, value);
    }
  }
  if (status === undefined || status < HTTP_INFORMATIONAL_MIN) return undefined;
  return { status, headers };
}

function hasNoBody(stream: Stream) {
  return stream.request.method === 'HEAD' || stream.status === HTTP_NO_CONTENT || stream.status === HTTP_NOT_MODIFIED;
}

function removePadding(flags: number, payload: Uint8Array) {
  if (!(flags & FLAG_PADDED)) return payload;
  const padLength = payload[0];
  if (payload.length < padLength + 1) throw new ConnectionError(ERROR_PROTOCOL, 'Invalid padding');
  return payload.subarray(1, payload.length - padLength);
}

function encodeFrame(type: number, flags: number, streamId: number, payload: Uint8Array) {
  const frame = new Uint8Array(FRAME_HEADER_LENGTH + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.length << 8);
  frame[3] = type;
  frame[4] = flags;
  view.setUint32(5, streamId);
  frame.set(payload, FRAME_HEADER_LENGTH);
  return frame;
}

function encodeWindowUpdate(streamId: number, increment: number) {
  const payload = new Uint8Array(WINDOW_UPDATE_LENGTH);
  new DataView(payload.buffer).setUint32(0, increment);
  return encodeFrame(FRAME_WINDOW_UPDATE, 0, streamId, payload);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  // `slice` copies into a fresh `ArrayBuffer`, which `HttpResponse.body` requires
  if (chunks.length === 1) return chunks[0].slice();
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
