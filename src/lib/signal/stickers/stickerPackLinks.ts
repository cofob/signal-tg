// Signal Desktop `ts/types/Stickers.preload.ts` (`getDataFromLink`)
const STICKER_LINK_REGEX = /^(?:https:\/\/signal\.art\/addstickers\/?#|sgnl:\/\/addstickers\/?\?)(.+)$/i;
const HEX_REGEX = /^[0-9a-f]+$/i;
const PACK_ID_LENGTH = 16;
const PACK_KEY_LENGTH = 32;

/** Whether `id` and `key` are a 16-byte pack id and a 32-byte pack key in hex */
export function getIsStickerPackValid(id: string, key: string) {
  return id.length === PACK_ID_LENGTH * 2 && key.length === PACK_KEY_LENGTH * 2 && HEX_REGEX.test(id + key);
}

/** The pack of a `https://signal.art/addstickers/#pack_id=…&pack_key=…` or `sgnl://addstickers/?…` link */
export function parseStickerPackLink(url: string) {
  const match = url.match(STICKER_LINK_REGEX);
  if (!match) return undefined;
  const params = new URLSearchParams(match[1]);
  const id = params.get('pack_id')?.toLowerCase();
  const key = params.get('pack_key')?.toLowerCase();
  return id && key && getIsStickerPackValid(id, key) ? { id, key } : undefined;
}
