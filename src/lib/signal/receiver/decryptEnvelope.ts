import { fromBinary } from '@bufbuild/protobuf';

import type { Content, Envelope } from '../proto/generated/SignalService_pb';
import type { LocalIdentity, ProtocolStores } from '../store/protocolStores';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord } from '../store/SignalStore';

import { SIGNAL_SERVER_TRUST_ROOTS } from '../config';
import { bufferFromBase64 } from '../../../util/encoding/buffer';
import { unpadMessage } from '../crypto';
import { isPniServiceId, toPniServiceId } from '../serviceId';
import { createProtocolStores } from '../store/protocolStores';
import { wasm } from '../wasm';

import { ContentSchema, Envelope_Type } from '../proto/generated/SignalService_pb';

export type DecryptedEnvelope = {
  envelope: Envelope;
  senderServiceId: string;
  senderDeviceId: number;
  // The local identity the envelope was sent to: the ACI or the PNI
  destinationServiceId: string;
  content: Content;
  isSealedSender: boolean;
  // Group id of the sealed sender envelope
  groupId?: Uint8Array;
};

type DecryptionErrorDetails = {
  senderServiceId: string;
  senderDeviceId: number;
  timestamp: number;
  // The ciphertext that failed and its `CiphertextMessageType`
  ciphertext: Uint8Array;
  messageType: number;
  contentHint: number;
  groupId?: Uint8Array;
};

/** Decryption failed after the sender was known, so the sender can be asked to resend */
export class DecryptionError extends Error {
  constructor(readonly details: DecryptionErrorDetails, cause: unknown) {
    super(`Decryption of a message from ${details.senderServiceId}.${details.senderDeviceId} failed`, { cause });
  }
}

// `CiphertextMessageType` in libsignal
const MESSAGE_TYPE_WHISPER = 2;
const MESSAGE_TYPE_PREKEY = 3;
const MESSAGE_TYPE_SENDER_KEY = 7;
const MESSAGE_TYPE_PLAINTEXT = 8;
const MESSAGE_TYPE_BY_ENVELOPE_TYPE: Partial<Record<Envelope_Type, number>> = {
  [Envelope_Type.DOUBLE_RATCHET]: MESSAGE_TYPE_WHISPER,
  [Envelope_Type.PREKEY_MESSAGE]: MESSAGE_TYPE_PREKEY,
  [Envelope_Type.PLAINTEXT_CONTENT]: MESSAGE_TYPE_PLAINTEXT,
};
// `ContentHint.Default` in libsignal: identified envelopes carry no hint
const CONTENT_HINT_DEFAULT = 0;

let trustRoots: wasm.PublicKey[] | undefined;

/**
 * Decrypts an envelope from the chat socket and processes the sender key distribution message it carries
 * (Signal Desktop `MessageReceiver.#decrypt`). Failures after the sender is known throw `DecryptionError`,
 * except for duplicates. Server delivery receipts carry no content and are not handled here.
 */
export function decryptEnvelope(store: SignalStore, account: AccountRecord, envelope: Envelope) {
  return store.runExclusive(async () => {
    const decrypted = await decrypt(store, account, envelope);
    const distributionMessage = decrypted.content.senderKeyDistributionMessage;
    if (distributionMessage.length) {
      const local = await getLocalIdentity(store, account, envelope);
      await wasm.SenderKeyDistributionMessage_Process(
        wasm.ProtocolAddress_New(decrypted.senderServiceId, decrypted.senderDeviceId),
        wasm.SenderKeyDistributionMessage_Deserialize(distributionMessage),
        createProtocolStores(store, local).senderKey,
      );
    }
    return decrypted;
  });
}

async function decrypt(store: SignalStore, account: AccountRecord, envelope: Envelope): Promise<DecryptedEnvelope> {
  const local = await getLocalIdentity(store, account, envelope);
  const stores = createProtocolStores(store, local);
  const localAddress = wasm.ProtocolAddress_New(local.serviceId, account.deviceId);
  const ciphertext = envelope.content;
  if (!ciphertext.length) throw new Error('Envelope has no content');

  if (envelope.type === Envelope_Type.UNIDENTIFIED_SENDER) {
    const usmc = await wasm.SealedSender_DecryptToUsmc(ciphertext, stores.identity);
    const certificate = wasm.UnidentifiedSenderMessageContent_GetSenderCert(usmc);
    const senderServiceId = wasm.SenderCertificate_GetSenderUuid(certificate);
    const senderDeviceId = wasm.SenderCertificate_GetDeviceId(certificate);

    if (senderServiceId === account.aci && senderDeviceId === account.deviceId) {
      throw new Error('Received a sealed sender message sent by this device');
    }
    const serverTimestamp = Number(envelope.serverTimestamp);
    const roots = getTrustRoots().map((root) => root.cloneHandle());
    if (!wasm.SenderCertificate_Validate(certificate, roots, serverTimestamp)) {
      throw new Error('Sealed sender certificate validation failed');
    }

    const messageType = wasm.UnidentifiedSenderMessageContent_GetMsgType(usmc);
    const contents = wasm.UnidentifiedSenderMessageContent_GetContents(usmc);
    const groupId = wasm.UnidentifiedSenderMessageContent_GetGroupId(usmc);
    const senderAddress = wasm.ProtocolAddress_New(senderServiceId, senderDeviceId);
    let plaintext: Uint8Array;
    try {
      // Plaintext content bodies end with the same 0x80 terminator as padded messages
      plaintext = unpadMessage(messageType === MESSAGE_TYPE_PLAINTEXT
        ? wasm.PlaintextContent_GetBody(wasm.PlaintextContent_Deserialize(contents))
        : await decryptMessage(messageType, contents, senderAddress, localAddress, stores));
    } catch (err) {
      throw toDecryptionError(err, {
        senderServiceId,
        senderDeviceId,
        timestamp: Number(envelope.clientTimestamp),
        ciphertext: contents,
        messageType,
        contentHint: wasm.UnidentifiedSenderMessageContent_GetContentHint(usmc),
        groupId,
      });
    }

    return {
      envelope,
      senderServiceId,
      senderDeviceId,
      destinationServiceId: local.serviceId,
      content: fromBinary(ContentSchema, plaintext),
      isSealedSender: true,
      groupId,
    };
  }

  const senderServiceId = envelope.sourceServiceIdBinary.length
    ? getServiceIdString(envelope.sourceServiceIdBinary)
    : envelope.sourceServiceId;
  const senderDeviceId = envelope.sourceDeviceId;
  if (!senderServiceId || !senderDeviceId) throw new Error('Envelope has no source');
  const senderAddress = wasm.ProtocolAddress_New(senderServiceId, senderDeviceId);

  const messageType = MESSAGE_TYPE_BY_ENVELOPE_TYPE[envelope.type];
  if (!messageType) throw new Error(`Unsupported envelope type ${envelope.type}`);

  let plaintext: Uint8Array;
  try {
    plaintext = messageType === MESSAGE_TYPE_PLAINTEXT
      ? wasm.PlaintextContent_GetBody(wasm.PlaintextContent_Deserialize(ciphertext))
      : await decryptMessage(messageType, ciphertext, senderAddress, localAddress, stores);
  } catch (err) {
    throw toDecryptionError(err, {
      senderServiceId,
      senderDeviceId,
      timestamp: Number(envelope.clientTimestamp),
      ciphertext,
      messageType,
      contentHint: CONTENT_HINT_DEFAULT,
    });
  }

  return {
    envelope,
    senderServiceId,
    senderDeviceId,
    destinationServiceId: local.serviceId,
    content: fromBinary(ContentSchema, unpadMessage(plaintext)),
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

/** A duplicate was already processed and needs no resend */
function toDecryptionError(err: unknown, details: DecryptionErrorDetails) {
  if ((err as { libsignalName?: string }).libsignalName === 'DuplicatedMessage') return err;
  return new DecryptionError(details, err);
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
  if (envelope.destinationServiceIdBinary.length) {
    return getServiceIdString(envelope.destinationServiceIdBinary);
  }
  return envelope.destinationServiceId || undefined;
}

/** Converts a service id binary (16 bytes for an ACI, with a type prefix for a PNI) to its string form */
function getServiceIdString(binary: Uint8Array) {
  return wasm.ServiceId_ServiceIdString(wasm.ServiceId_ParseFromServiceIdBinary(binary));
}

function getTrustRoots() {
  trustRoots ??= SIGNAL_SERVER_TRUST_ROOTS.map((root) => wasm.PublicKey_Deserialize(bufferFromBase64(root)));
  return trustRoots;
}
