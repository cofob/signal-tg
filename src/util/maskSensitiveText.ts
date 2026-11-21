import { DEBUG } from '../config';

// Service ids and group ids are UUIDs or base64 of key-sized values, phone numbers are E.164
const UUID_REGEX = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi;
const PHONE_NUMBER_REGEX = /\+\d{6,15}/g;
// Keys, ids and digests in hex or base64; the shortest of them is a 128-bit value in hex
const ENCODED_BYTES_REGEX = /[\w+/-]{32,}={0,2}/g;

/** Replaces the identifiers and key-sized values that error text can carry, which logs must not hold */
export default function maskSensitiveText(text: string) {
  return text
    .replace(UUID_REGEX, '[id]')
    .replace(PHONE_NUMBER_REGEX, '[number]')
    .replace(ENCODED_BYTES_REGEX, '[data]');
}

/**
 * What to pass to `console.error`: the error itself in development builds, and its masked text otherwise, because
 * messages of failed requests and lookups name accounts and numbers
 */
export function getLoggableError(error: unknown) {
  if (DEBUG) return error;

  const text = error instanceof Error ? error.stack || `${error.name}: ${error.message}` : String(error);
  return maskSensitiveText(text);
}
