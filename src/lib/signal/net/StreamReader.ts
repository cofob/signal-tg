type ReadChunk = () => Promise<Uint8Array | undefined>;

/** Buffered reads from a chunked byte stream */
export default class StreamReader {
  private buffer = new Uint8Array(0);

  private isEnded = false;

  constructor(private readChunk: ReadChunk) {}

  /** Returns the bytes before `delimiter` and consumes the delimiter */
  async readUntil(delimiter: Uint8Array) {
    let searchFrom = 0;
    for (;;) {
      const index = findSequence(this.buffer, delimiter, searchFrom);
      if (index !== -1) {
        const result = this.buffer.slice(0, index);
        this.buffer = this.buffer.subarray(index + delimiter.length);
        return result;
      }
      searchFrom = Math.max(0, this.buffer.length - delimiter.length + 1);
      if (!await this.fill()) throw new Error('Stream ended before delimiter');
    }
  }

  /** Reads `length` bytes into one buffer, so large bodies are not copied per chunk; `onRead` gets the count so far */
  async readExactly(length: number, onRead?: (readLength: number) => void) {
    const result = new Uint8Array(length);
    let offset = 0;
    for (;;) {
      const part = this.buffer.subarray(0, length - offset);
      result.set(part, offset);
      offset += part.length;
      this.buffer = this.buffer.subarray(part.length);
      onRead?.(offset);
      if (offset === length) return result;
      if (!await this.fill()) throw new Error('Stream ended early');
    }
  }

  /** Reads until the stream ends */
  async readToEnd() {
    while (await this.fill()) {
      // Keep buffering
    }
    const result = this.buffer;
    this.buffer = new Uint8Array(0);
    return result;
  }

  private async fill() {
    if (this.isEnded) return false;
    const chunk = await this.readChunk();
    if (!chunk) {
      this.isEnded = true;
      return false;
    }
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer);
    next.set(chunk, this.buffer.length);
    this.buffer = next;
    return true;
  }
}

function findSequence(haystack: Uint8Array, needle: Uint8Array, from: number) {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
