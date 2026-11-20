const UUID_LENGTH = 16;
const PNI_PREFIX = 'PNI:';

/** Formats 16 UUID bytes as a lowercase hyphenated string */
export function uuidToString(bytes: Uint8Array) {
  if (bytes.length !== UUID_LENGTH) throw new Error('Invalid UUID length');
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The 16 bytes of a hyphenated UUID string, as in the binary ACI fields of protocol messages */
export function uuidToBytes(uuid: string) {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== UUID_LENGTH * 2) throw new Error('Invalid UUID');
  return Uint8Array.from({ length: UUID_LENGTH }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

/** The service id string of a PNI, as used in protocol addresses and `destinationServiceId` */
export function toPniServiceId(untaggedPni: string) {
  return `${PNI_PREFIX}${untaggedPni}`;
}

export function isPniServiceId(serviceId: string) {
  return serviceId.startsWith(PNI_PREFIX);
}
