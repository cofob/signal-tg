import type { Envelope } from '../proto/generated/SignalService';
import type { LocalIdentity, ProtocolStores } from '../store/protocolStores';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord } from '../store/SignalStore';

import { SIGNAL_SERVER_TRUST_ROOTS } from '../config';
import { bufferFromBase64 } from '../../../util/encoding/buffer';
import { unpadMessage } from '../crypto';
import { isPniServiceId, toPniServiceId } from '../serviceId';
import { createProtocolStores } from '../store/protocolStores';
import { wasm } from '../wasm';

import { Content, Envelope_Type } from '../proto/generated/SignalService';

export type DecryptedEnvelope = {
  envelope: Envelope;
  senderServiceId: string;
  senderDeviceId: number;
  // The local identity the envelope was sent to: the ACI or the PNI
  destinationServiceId: string;
  content: Content;
  isSealedSender: boolean;
};

// `CiphertextMessageType` in libsignal
const MESSAGE_TYPE_WHISPER = 2;
const MESSAGE_TYPE_PREKEY = 3;
const MESSAGE_TYPE_SENDER_KEY = 7;
const MESSAGE_TYPE_PLAINTEXT = 8;

let trustRoots: wasm.PublicKey[] | undefined;

/**
 * Decrypts an envelope from the chat socket (Signal Desktop `MessageReceiver.#decrypt`).
 * Server delivery receipts carry no content and are not handled here.
 */
export async function decryptEnvelope(
  store: SignalStore, account: AccountRecord, envelope: Envelope,
): Promise<DecryptedEnvelope> {
  const local = await getLocalIdentity(store, account, envelope);
  const stores = createProtocolStores(store, local);
  const localAddress = wasm.ProtocolAddress_New(local.serviceId, account.deviceId);
  const ciphertext = envelope.content;
  if (!ciphertext) throw new Error('Envelope has no content');

  if (envelope.type === Envelope_Type.UNIDENTIFIED_SENDER) {
    const usmc = await wasm.SealedSender_DecryptToUsmc(ciphertext, stores.identity);
    const certificate = wasm.UnidentifiedSenderMessageContent_GetSenderCert(usmc);
    const senderServiceId = wasm.SenderCertificate_GetSenderUuid(certificate);
    const senderDeviceId = wasm.SenderCertificate_GetDeviceId(certificate);

    if (senderServiceId === account.aci && senderDeviceId === account.deviceId) {
      throw new Error('Received a sealed sender message sent by this device');
    }
    const serverTimestamp = Number(envelope.serverTimestamp ?? 0n);
    const roots = getTrustRoots().map((root) => root.cloneHandle());
    if (!wasm.SenderCertificate_Validate(certificate, roots, serverTimestamp)) {
      throw new Error('Sealed sender certificate validation failed');
    }

    const messageType = wasm.UnidentifiedSenderMessageContent_GetMsgType(usmc);
    const contents = wasm.UnidentifiedSenderMessageContent_GetContents(usmc);
    const senderAddress = wasm.ProtocolAddress_New(senderServiceId, senderDeviceId);
    const plaintext = messageType === MESSAGE_TYPE_PLAINTEXT
      ? wasm.PlaintextContent_GetBody(wasm.PlaintextContent_Deserialize(contents))
      : unpadMessage(await decryptMessage(messageType, contents, senderAddress, localAddress, stores));

    return {
      envelope,
      senderServiceId,
      senderDeviceId,
      destinationServiceId: local.serviceId,
      content: Content.decode(plaintext),
      isSealedSender: true,
    };
  }

  const senderServiceId = envelope.sourceServiceId;
  const senderDeviceId = envelope.sourceDeviceId;
  if (!senderServiceId || !senderDeviceId) throw new Error('Envelope has no source');
  const senderAddress = wasm.ProtocolAddress_New(senderServiceId, senderDeviceId);

  let plaintext: Uint8Array;
  switch (envelope.type) {
    case Envelope_Type.DOUBLE_RATCHET:
      plaintext = await decryptMessage(MESSAGE_TYPE_WHISPER, ciphertext, senderAddress, localAddress, stores);
      break;
    case Envelope_Type.PREKEY_MESSAGE:
      plaintext = await decryptMessage(MESSAGE_TYPE_PREKEY, ciphertext, senderAddress, localAddress, stores);
      break;
    case Envelope_Type.PLAINTEXT_CONTENT:
      plaintext = wasm.PlaintextContent_GetBody(wasm.PlaintextContent_Deserialize(ciphertext));
      break;
    default:
      throw new Error(`Unsupported envelope type ${envelope.type}`);
  }

  return {
    envelope,
    senderServiceId,
    senderDeviceId,
    destinationServiceId: local.serviceId,
    content: Content.decode(unpadMessage(plaintext)),
    isSealedSender: false,
  };
}

async function decryptMessage(
  messageType: number,
  ciphertext: Uint8Array,
  senderAddress: wasm.ProtocolAddress,
  localAddress: wasm.ProtocolAddress,
  stores: ProtocolStores,
): Promise<Uint8Array> {
  switch (messageType) {
    case MESSAGE_TYPE_WHISPER:
      return wasm.SessionCipher_DecryptSignalMessage(
        wasm.SignalMessage_Deserialize(ciphertext), senderAddress, localAddress, stores.session, stores.identity,
      );
    case MESSAGE_TYPE_PREKEY:
      return wasm.SessionCipher_DecryptPreKeySignalMessage(
        wasm.PreKeySignalMessage_Deserialize(ciphertext),
        senderAddress,
        localAddress,
        stores.session,
        stores.identity,
        stores.preKey,
        stores.signedPreKey,
        stores.kyberPreKey,
      );
    case MESSAGE_TYPE_SENDER_KEY:
      return wasm.GroupCipher_DecryptMessage(senderAddress, ciphertext, stores.senderKey);
    default:
      throw new Error(`Unsupported message type ${messageType}`);
  }
}

async function getLocalIdentity(
  store: SignalStore, account: AccountRecord, envelope: Envelope,
): Promise<LocalIdentity> {
  const destination = getDestinationServiceId(envelope);
  if (destination && isPniServiceId(destination)) {
    const keyPair = await store.getItem('pniIdentityKeyPair');
    if (!account.pni || !keyPair || destination !== toPniServiceId(account.pni)) {
      throw new Error('Envelope is addressed to an unknown PNI');
    }
    return { serviceId: destination, keyPair, registrationId: account.pniRegistrationId };
  }

  const keyPair = await store.getItem('aciIdentityKeyPair');
  if (!keyPair) throw new Error('ACI identity key is missing');
  return { serviceId: account.aci, keyPair, registrationId: account.registrationId };
}

function getDestinationServiceId(envelope: Envelope) {
  if (envelope.destinationServiceIdBinary?.length) {
    const fixedWidth = wasm.ServiceId_ParseFromServiceIdBinary(envelope.destinationServiceIdBinary);
    return wasm.ServiceId_ServiceIdString(fixedWidth);
  }
  return envelope.destinationServiceId;
}

function getTrustRoots() {
  trustRoots ??= SIGNAL_SERVER_TRUST_ROOTS.map((root) => wasm.PublicKey_Deserialize(bufferFromBase64(root)));
  return trustRoots;
}
