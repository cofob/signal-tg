// HPACK header compression for HTTP/2 (RFC 7541). The encoder writes literals without indexing or Huffman
// coding; the decoder supports the full format within fixed size limits.

export type HeaderField = [name: string, value: string];

type TableEntry = {
  name: string;
  value: string;
  // Octets of the name, and of the entry with its overhead
  nameLength: number;
  size: number;
};

const STATIC_TABLE: HeaderField[] = [
  [':authority', ''], [':method', 'GET'], [':method', 'POST'], [':path', '/'], [':path', '/index.html'],
  [':scheme', 'http'], [':scheme', 'https'], [':status', '200'], [':status', '204'], [':status', '206'],
  [':status', '304'], [':status', '400'], [':status', '404'], [':status', '500'], ['accept-charset', ''],
  ['accept-encoding', 'gzip, deflate'], ['accept-language', ''], ['accept-ranges', ''], ['accept', ''],
  ['access-control-allow-origin', ''], ['age', ''], ['allow', ''], ['authorization', ''], ['cache-control', ''],
  ['content-disposition', ''], ['content-encoding', ''], ['content-language', ''], ['content-length', ''],
  ['content-location', ''], ['content-range', ''], ['content-type', ''], ['cookie', ''], ['date', ''], ['etag', ''],
  ['expect', ''], ['expires', ''], ['from', ''], ['host', ''], ['if-match', ''], ['if-modified-since', ''],
  ['if-none-match', ''], ['if-range', ''], ['if-unmodified-since', ''], ['last-modified', ''], ['link', ''],
  ['location', ''], ['max-forwards', ''], ['proxy-authenticate', ''], ['proxy-authorization', ''], ['range', ''],
  ['referer', ''], ['refresh', ''], ['retry-after', ''], ['server', ''], ['set-cookie', ''],
  ['strict-transport-security', ''], ['transfer-encoding', ''], ['user-agent', ''], ['vary', ''], ['via', ''],
  ['www-authenticate', ''],
];

// Huffman code length of each octet (RFC 7541 Appendix B) as `length - 5 + 'A'`. The code is canonical:
// codes of one length are consecutive in symbol order, so the lengths define it.
const HUFFMAN_CODE_LENGTHS = 'ISXXXXXXXTZXXZXXXXXXXXZXXXXXXXXXBFFHIBDGFFDGDBBBAAABBBBBBBCDKBHF'
  + 'IBCCCCCCCCCCCCCCCCCCCCCCDCDIOIJBKABABABBBACCBBBABCBAABCCCCCKGJIX'
  + 'PRPPRRRSRSSSSSTSTTRSTSSSSQRSRSSTRQPRRSSQSRRTQRSSQQRQSRSSPRRRSRRS'
  + 'VVPORSRUVVVWWVTUOQVWWVWTQQVVXWWWPTPQRQQSRRUUTTVSVWVVWWWWWXWWWWWV';
const HUFFMAN_LENGTH_OFFSET = 'A'.charCodeAt(0) - 5;
const HUFFMAN_EOS = 256;
const HUFFMAN_EOS_LENGTH = 30;
const HUFFMAN_MIN_LENGTH = 5;
const HUFFMAN_MAX_PADDING = 7;
const BITS_PER_OCTET = 8;

const ENTRY_OVERHEAD = 32;
const DEFAULT_TABLE_SIZE = 4096;
const MAX_INTEGER = 2 ** 31 - 1;
const MAX_INTEGER_SHIFT = 28;

const INDEXED_PREFIX = 7;
const INDEXED_LITERAL_PREFIX = 6;
const SIZE_UPDATE_PREFIX = 5;
const LITERAL_PREFIX = 4;
const STRING_PREFIX = 7;
const PATTERN_INDEXED = 0x80;
const PATTERN_INDEXED_LITERAL = 0x40;
const PATTERN_SIZE_UPDATE = 0x20;
const HUFFMAN_FLAG = 0x80;
const CONTINUATION_FLAG = 0x80;
const CONTINUATION_MASK = 0x7f;
const CONTINUATION_BITS = 7;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const huffmanTable = buildHuffmanTable();

export class HpackError extends Error {}

/** Encodes header fields as literals without indexing, so the peer's table size does not matter */
export function encodeHeaders(fields: HeaderField[]) {
  const parts: number[] = [];
  for (const [name, value] of fields) {
    const nameIndex = STATIC_TABLE.findIndex(([staticName]) => staticName === name) + 1;
    pushInteger(parts, nameIndex, LITERAL_PREFIX, 0);
    if (!nameIndex) pushString(parts, name);
    pushString(parts, value);
  }
  return Uint8Array.from(parts);
}

function pushInteger(parts: number[], value: number, prefixBits: number, pattern: number) {
  const prefixMax = (1 << prefixBits) - 1;
  if (value < prefixMax) {
    parts.push(pattern | value);
    return;
  }
  parts.push(pattern | prefixMax);
  let rest = value - prefixMax;
  while (rest > CONTINUATION_MASK) {
    parts.push((rest & CONTINUATION_MASK) | CONTINUATION_FLAG);
    rest >>>= CONTINUATION_BITS;
  }
  parts.push(rest);
}

function pushString(parts: number[], value: string) {
  const bytes = textEncoder.encode(value);
  pushInteger(parts, bytes.length, STRING_PREFIX, 0);
  for (const byte of bytes) parts.push(byte);
}

/** Decodes header blocks of one connection, keeping its dynamic table */
export class HpackDecoder {
  // Newest entry first
  private entries: TableEntry[] = [];

  private size = 0;

  private maxSize = DEFAULT_TABLE_SIZE;

  /** Throws `HpackError` on malformed input or when the fields exceed `maxListSize` (RFC 9113 section 6.5.2) */
  decode(block: Uint8Array, maxListSize: number) {
    const reader = new BlockReader(block);
    const fields: HeaderField[] = [];
    let listSize = 0;
    let canUpdateSize = true;

    while (!reader.isDone) {
      const byte = reader.peek();
      let entry: TableEntry;
      if (byte & PATTERN_INDEXED) {
        entry = this.getEntry(reader.readInteger(INDEXED_PREFIX));
      } else if (byte & PATTERN_INDEXED_LITERAL) {
        entry = this.readLiteral(reader, INDEXED_LITERAL_PREFIX);
        this.addEntry(entry);
      } else if (byte & PATTERN_SIZE_UPDATE) {
        // Size updates come only at the start of a block (RFC 7541 section 4.2)
        if (!canUpdateSize) throw new HpackError('Misplaced table size update');
        const maxSize = reader.readInteger(SIZE_UPDATE_PREFIX);
        if (maxSize > DEFAULT_TABLE_SIZE) throw new HpackError('Table size update above the limit');
        this.maxSize = maxSize;
        this.evict(0);
        continue;
      } else {
        // Literal without indexing or never indexed
        entry = this.readLiteral(reader, LITERAL_PREFIX);
      }
      canUpdateSize = false;
      listSize += entry.size;
      if (listSize > maxListSize) throw new HpackError('Header list is too large');
      fields.push([entry.name, entry.value]);
    }
    return fields;
  }

  private readLiteral(reader: BlockReader, prefixBits: number): TableEntry {
    const nameIndex = reader.readInteger(prefixBits);
    let name: string;
    let nameLength: number;
    if (nameIndex) {
      const entry = this.getEntry(nameIndex);
      name = entry.name;
      nameLength = entry.nameLength;
    } else {
      const bytes = reader.readString();
      name = textDecoder.decode(bytes);
      nameLength = bytes.length;
    }
    const valueBytes = reader.readString();
    return {
      name, value: textDecoder.decode(valueBytes), nameLength, size: ENTRY_OVERHEAD + nameLength + valueBytes.length,
    };
  }

  private getEntry(index: number): TableEntry {
    if (index >= 1 && index <= STATIC_TABLE.length) {
      const [name, value] = STATIC_TABLE[index - 1];
      return {
        name, value, nameLength: name.length, size: ENTRY_OVERHEAD + name.length + value.length,
      };
    }
    const entry = this.entries[index - STATIC_TABLE.length - 1];
    if (!entry) throw new HpackError(`Invalid table index ${index}`);
    return entry;
  }

  private addEntry(entry: TableEntry) {
    // An entry larger than the table empties it (RFC 7541 section 4.4)
    this.evict(entry.size);
    if (entry.size > this.maxSize) return;
    this.entries.unshift(entry);
    this.size += entry.size;
  }

  /** Evicts the oldest entries until `freeSize` more fits */
  private evict(freeSize: number) {
    while (this.entries.length && this.size + freeSize > this.maxSize) {
      this.size -= this.entries.pop()!.size;
    }
  }
}

class BlockReader {
  private offset = 0;

  constructor(private block: Uint8Array) {}

  get isDone() {
    return this.offset >= this.block.length;
  }

  peek() {
    return this.block[this.offset];
  }

  /** RFC 7541 section 5.1 */
  readInteger(prefixBits: number) {
    const prefixMax = (1 << prefixBits) - 1;
    let value = this.readByte() & prefixMax;
    if (value < prefixMax) return value;
    for (let shift = 0; ; shift += CONTINUATION_BITS) {
      if (shift > MAX_INTEGER_SHIFT) throw new HpackError('Integer is too long');
      const byte = this.readByte();
      value += (byte & CONTINUATION_MASK) * 2 ** shift;
      if (value > MAX_INTEGER) throw new HpackError('Integer is too large');
      if (!(byte & CONTINUATION_FLAG)) return value;
    }
  }

  /** RFC 7541 section 5.2 */
  readString() {
    const isHuffman = Boolean(this.peek() & HUFFMAN_FLAG);
    const length = this.readInteger(STRING_PREFIX);
    if (length > this.block.length - this.offset) throw new HpackError('String exceeds the block');
    const bytes = this.block.subarray(this.offset, this.offset + length);
    this.offset += length;
    return isHuffman ? decodeHuffman(bytes) : bytes;
  }

  private readByte() {
    if (this.isDone) throw new HpackError('Block ended early');
    return this.block[this.offset++];
  }
}

function decodeHuffman(bytes: Uint8Array) {
  const { firstCodes, counts, offsets, symbols } = huffmanTable;
  // The shortest code has 5 bits, which bounds the output
  const result = new Uint8Array(Math.floor((bytes.length * BITS_PER_OCTET) / HUFFMAN_MIN_LENGTH));
  let resultLength = 0;
  let code = 0;
  let codeLength = 0;
  for (const byte of bytes) {
    for (let bit = BITS_PER_OCTET - 1; bit >= 0; bit--) {
      code = code * 2 + ((byte >> bit) & 1);
      codeLength++;
      const index = code - firstCodes[codeLength];
      if (index >= 0 && index < counts[codeLength]) {
        const symbol = symbols[offsets[codeLength] + index];
        if (symbol === HUFFMAN_EOS) throw new HpackError('Huffman string contains EOS');
        result[resultLength++] = symbol;
        code = 0;
        codeLength = 0;
      }
    }
  }
  // Padding is a prefix of EOS: at most 7 one bits (RFC 7541 section 5.2)
  if (codeLength > HUFFMAN_MAX_PADDING || code !== 2 ** codeLength - 1) {
    throw new HpackError('Invalid Huffman padding');
  }
  return result.subarray(0, resultLength);
}

function buildHuffmanTable() {
  const lengths = Array.from(HUFFMAN_CODE_LENGTHS, (char) => char.charCodeAt(0) - HUFFMAN_LENGTH_OFFSET);
  lengths.push(HUFFMAN_EOS_LENGTH);

  const counts = new Array<number>(HUFFMAN_EOS_LENGTH + 1).fill(0);
  for (const length of lengths) counts[length]++;
  const symbols = lengths.map((length, symbol) => ({ length, symbol }))
    .sort((a, b) => a.length - b.length || a.symbol - b.symbol)
    .map(({ symbol }) => symbol);

  const firstCodes = new Array<number>(HUFFMAN_EOS_LENGTH + 1).fill(0);
  const offsets = new Array<number>(HUFFMAN_EOS_LENGTH + 1).fill(0);
  let code = 0;
  let offset = 0;
  for (let length = 1; length <= HUFFMAN_EOS_LENGTH; length++) {
    firstCodes[length] = code;
    offsets[length] = offset;
    code = (code + counts[length]) * 2;
    offset += counts[length];
  }
  return {
    firstCodes, counts, offsets, symbols,
  };
}
