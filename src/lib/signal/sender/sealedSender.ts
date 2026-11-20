import type ChatConnection from '../chat/ChatConnection';
import type SignalStore from '../store/SignalStore';

import { bufferFromBase64, buffersEqual, bufferToBase64 } from '../../../util/encoding/buffer';
import { getServerTime } from '../../../util/serverTime';
import { wasm } from '../wasm';

const ACCESS_KEY_LENGTH = 16;
// Recipients with unrestricted sealed sender access accept any access key; clients send zeros
const ZERO_ACCESS_KEY = bufferToBase64(new Uint8Array(ACCESS_KEY_LENGTH));
const CERTIFICATE_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
const HTTP_OK = 200;

/**
 * Returns the base64 `Unidentified-Access-Key` for sealed sender sends to `aci`, or `undefined` when sends
 * to it must be identified (Signal Desktop `ts/util/getSendOptions.preload.ts`)
 */
export async function getAccessKey(store: SignalStore, aci: string) {
  const recipient = await store.getRecipient(aci);
  if (recipient?.sealedSender === 'disabled') return undefined;
  if (recipient?.sealedSender === 'unrestricted' || !recipient?.profileKey) return ZERO_ACCESS_KEY;
  return bufferToBase64(wasm.ProfileKey_DeriveAccessKey(recipient.profileKey));
}

/** Stores the profile key of `aci`; a new key may grant sealed sender access that the old one did not */
export async function saveProfileKey(store: SignalStore, aci: string, profileKey: Uint8Array) {
  const recipient = await store.getRecipient(aci);
  if (recipient?.profileKey && buffersEqual(recipient.profileKey, profileKey)) return;
  await store.updateRecipient(aci, { profileKey, sealedSender: undefined });
}

/**
 * Returns the certificate that sealed sender envelopes carry. It omits our phone number, so accounts with
 * and without one use the same certificate. It is renewed a day before it expires.
 */
export async function getSenderCertificate(store: SignalStore, connection: ChatConnection) {
  const cached = await store.getItem('senderCertificate');
  if (cached && cached.expiresAt - CERTIFICATE_REFRESH_MARGIN_MS > getServerTime() * 1000) {
    return wasm.SenderCertificate_Deserialize(cached.serialized);
  }

  const { status, json } = await connection.sendJsonRequest<{ certificate: string }>(
    'GET', '/v1/certificate/delivery?includeE164=false',
  );
  if (status !== HTTP_OK || !json) throw new Error(`Sender certificate request failed with HTTP ${status}`);

  const serialized = bufferFromBase64(json.certificate);
  const certificate = wasm.SenderCertificate_Deserialize(serialized);
  await store.setItem('senderCertificate', {
    serialized,
    expiresAt: wasm.SenderCertificate_GetExpiration(certificate),
  });
  return certificate;
}
