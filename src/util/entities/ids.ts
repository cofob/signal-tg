import { toJSNumber } from '../numbers';

export function isUserId(entityId: string) {
  return !entityId.startsWith('-');
}

export function getRawPeerId(id: string) {
  const n = BigInt(id);
  return isUserId(id) ? n : -n;
}

export function getPeerIdDividend(peerId: string) {
  return toJSNumber(getRawPeerId(peerId));
}
