const HEX_REGEX = /^[0-9a-f]+$/i;
const PACK_ID_LENGTH = 16;
const PACK_KEY_LENGTH = 32;

/** Whether `id` and `key` are a 16-byte pack id and a 32-byte pack key in hex */
export function getIsStickerPackValid(id: string, key: string) {
  return id.length === PACK_ID_LENGTH * 2 && key.length === PACK_KEY_LENGTH * 2 && HEX_REGEX.test(id + key);
}
