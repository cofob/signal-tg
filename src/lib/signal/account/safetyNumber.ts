import type SignalStore from '../store/SignalStore';

import { uuidToBytes } from '../serviceId';
import { wasm } from '../wasm';

export type SafetyNumber = {
  // 60 digits
  digits: string;
  // What the QR code encodes for scanning on a phone
  scannable: Uint8Array;
};

// Signal Desktop `ts/util/safetyNumber.preload.ts`: version 2 fingerprints combine ACIs, not phone numbers
const ITERATION_COUNT = 5200;
const SERVICE_ID_VERSION = 2;

/** The safety number with `aci`, or `undefined` while we do not know their identity key */
export async function generateSafetyNumber(store: SignalStore, ourAci: string, aci: string) {
  const ourKeyPair = await store.getItem('aciIdentityKeyPair');
  const identity = await store.getIdentity(aci);
  if (!ourKeyPair || !identity) return undefined;

  const fingerprint = wasm.Fingerprint_New(
    ITERATION_COUNT,
    SERVICE_ID_VERSION,
    uuidToBytes(ourAci),
    wasm.PublicKey_Deserialize(ourKeyPair.publicKey),
    uuidToBytes(aci),
    wasm.PublicKey_Deserialize(identity.publicKey),
  );
  return {
    digits: wasm.Fingerprint_DisplayString(fingerprint),
    scannable: wasm.Fingerprint_ScannableEncoding(fingerprint),
  } satisfies SafetyNumber;
}
