import type SignalStore from './SignalStore';
import type { KeyPairBytes } from './SignalStore';

import { buffersEqual } from '../../../util/encoding/buffer';

export type LocalIdentity = {
  serviceId: string;
  keyPair: KeyPairBytes;
  registrationId: number;
};

const IDENTITY_NEW_OR_UNCHANGED = 0;
const IDENTITY_REPLACED_EXISTING = 1;
const DIRECTION_SENDING = 0;

/**
 * Builds the byte-level stores that `rust/signal-wasm` calls (see `rust/signal-wasm/src/stores.rs`)
 * for one local identity: the ACI or the PNI.
 */
export function createProtocolStores(store: SignalStore, local: LocalIdentity) {
  const ourServiceId = local.serviceId;

  return {
    session: {
      loadSession: (name: string, deviceId: number) => store.getSession(`${name}.${deviceId}`),
      storeSession: (name: string, deviceId: number, record: Uint8Array) => (
        store.setSession(`${name}.${deviceId}`, record)
      ),
    },
    identity: {
      getLocalIdentityKeyPair: () => Promise.resolve([local.keyPair.privateKey, local.keyPair.publicKey]),
      getLocalRegistrationId: () => Promise.resolve(local.registrationId),
      getIdentityKey: (name: string) => store.getIdentity(name).then((record) => record?.publicKey),
      async saveIdentityKey(name: string, deviceId: number, publicKey: Uint8Array) {
        const existing = await store.getIdentity(name);
        if (existing && buffersEqual(existing.publicKey, publicKey)) return IDENTITY_NEW_OR_UNCHANGED;
        await store.setIdentity(name, { publicKey });
        return existing ? IDENTITY_REPLACED_EXISTING : IDENTITY_NEW_OR_UNCHANGED;
      },
      async isTrustedIdentity(name: string, deviceId: number, publicKey: Uint8Array, direction: number) {
        if (direction !== DIRECTION_SENDING) return true;
        const existing = await store.getIdentity(name);
        // A changed key of a verified contact needs the user's approval before sending
        return !existing?.isVerified || buffersEqual(existing.publicKey, publicKey);
      },
      recordReceivedIdentityKey: () => Promise.resolve(),
    },
    preKey: {
      loadPreKey: (id: number) => store.getPreKey(ourServiceId, id),
      storePreKey: (id: number, record: Uint8Array) => store.setPreKeys(ourServiceId, [[id, record]]),
      removePreKey: (id: number) => store.removePreKey(ourServiceId, id),
    },
    signedPreKey: {
      loadSignedPreKey: (id: number) => store.getSignedPreKey(ourServiceId, id),
      storeSignedPreKey: (id: number, record: Uint8Array) => store.setSignedPreKey(ourServiceId, id, record),
    },
    kyberPreKey: {
      loadKyberPreKey: (id: number) => store.getKyberPreKey(ourServiceId, id).then((entry) => entry?.record),
      storeKyberPreKey: (id: number, record: Uint8Array) => store.setKyberPreKeys(ourServiceId, [[id, { record }]]),
      async markKyberPreKeyUsed(id: number) {
        // Last-resort keys stay until they are rotated; one-time keys are used once
        const entry = await store.getKyberPreKey(ourServiceId, id);
        if (entry && !entry.isLastResort) await store.removeKyberPreKey(ourServiceId, id);
      },
    },
    senderKey: {
      loadSenderKey: (name: string, deviceId: number, distributionId: Uint8Array) => (
        store.getSenderKey(getSenderKeyId(name, deviceId, distributionId))
      ),
      storeSenderKey: (name: string, deviceId: number, distributionId: Uint8Array, record: Uint8Array) => (
        store.setSenderKey(getSenderKeyId(name, deviceId, distributionId), record)
      ),
    },
  };
}

export type ProtocolStores = ReturnType<typeof createProtocolStores>;

function getSenderKeyId(name: string, deviceId: number, distributionId: Uint8Array) {
  const distribution = Array.from(distributionId, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${name}.${deviceId}:${distribution}`;
}
