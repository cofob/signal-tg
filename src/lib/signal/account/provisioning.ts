import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type { ProvisionEnvelope } from '../proto/generated/ProvisionEnvelope_pb';
import type { ProvisionMessage } from '../proto/generated/Provisioning_pb';

import { SIGNAL_CHAT_HOST } from '../config';
import { bufferToBase64, concat } from '../../../util/encoding/buffer';
import {
  decryptAesCbc, deriveSecrets, encodeUtf8, encryptAesCbc, getRandomBytes, hmacSha256, verifyHmacSha256,
} from '../crypto';
import { wasm } from '../wasm';

import ResourceSocket from '../net/ResourceSocket';
import { ProvisionEnvelopeSchema } from '../proto/generated/ProvisionEnvelope_pb';
import { ProvisioningAddressSchema, ProvisionMessageSchema } from '../proto/generated/Provisioning_pb';

export type DeviceLinkSession = {
  url: string;
  // Resolves once the primary device scans the QR code and sends the provisioning message
  provisionMessage: Promise<ProvisionMessage>;
  cancel(): void;
};

const PROVISIONING_PATH = '/v1/websocket/provisioning/';
const PROVISIONING_KEEPALIVE_PATH = '/v1/keepalive/provisioning';
const ADDRESS_PATH = '/v1/address';
const MESSAGE_PATH = '/v1/message';
const PROVISIONING_INFO = 'TextSecure Provisioning Message';
const PROVISIONING_VERSION = 1;
const IV_LENGTH = 16;
const MAC_LENGTH = 32;
const KEY_LENGTH = 32;
const SALT = new Uint8Array(32);
// E164-less linking and link and sync, as in Signal Desktop (`LinkedDeviceCapabilities` in `ts/types/LinkedDevices.std.ts`)
const LINK_CAPABILITIES = ['nopni', 'nopni2', 'backup5'];
const HTTP_OK = 200;

/**
 * Opens the provisioning socket and returns the `sgnl://linkdevice` URL to show as a QR code
 * (Signal Desktop `ts/textsecure/Provisioner.preload.ts`).
 */
export async function startDeviceLink(): Promise<DeviceLinkSession> {
  const ephemeralKey = wasm.PrivateKey_Generate();
  const ephemeralPublicKey = wasm.PrivateKey_GetPublicKey(ephemeralKey);
  const socket = await ResourceSocket.connect(SIGNAL_CHAT_HOST, PROVISIONING_PATH, {}, PROVISIONING_KEEPALIVE_PATH);

  let resolveUrl: (url: string) => void;
  let rejectUrl: (error: Error) => void;
  const urlPromise = new Promise<string>((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });

  const provisionMessage = new Promise<ProvisionMessage>((resolve, reject) => {
    socket.onRequest = (request) => {
      if (request.verb === 'PUT' && request.path === ADDRESS_PATH && request.body) {
        const { address } = fromBinary(ProvisioningAddressSchema, request.body);
        request.respond(HTTP_OK, 'OK');
        if (!address) {
          rejectUrl(new Error('Provisioning address is missing'));
          return;
        }
        resolveUrl(buildLinkUrl(address, wasm.PublicKey_Serialize(ephemeralPublicKey)));
        return;
      }

      if (request.verb === 'PUT' && request.path === MESSAGE_PATH && request.body) {
        request.respond(HTTP_OK, 'OK');
        decryptProvisionEnvelope(fromBinary(ProvisionEnvelopeSchema, request.body), ephemeralKey)
          .then(resolve, reject)
          .finally(() => socket.close());
      }
    };

    socket.onClose = (code, reason) => {
      const error = new Error(`Provisioning socket closed: ${code} ${reason}`);
      rejectUrl(error);
      reject(error);
    };
  });
  // The caller may cancel before awaiting the message
  provisionMessage.catch(() => undefined);

  return {
    url: await urlPromise,
    provisionMessage,
    cancel: () => socket.close(),
  };
}

function buildLinkUrl(address: string, publicKey: Uint8Array) {
  const params = new URLSearchParams({
    uuid: address,
    pub_key: bufferToBase64(publicKey),
    capabilities: LINK_CAPABILITIES.join(','),
  });
  return `sgnl://linkdevice?${params}`;
}

/**
 * Encrypts a serialized `ProvisionMessage` to the public key of a device that wants to be linked, and returns the
 * serialized `ProvisionEnvelope`: the version, an IV, the AES-256-CBC ciphertext and an HMAC-SHA256 under keys from
 * an ECDH agreement with a fresh ephemeral key (libsignal `encrypt_provision_message`, Signal Android
 * `PrimaryProvisioningCipher`). `ephemeralKey` and `iv` are for known-answer tests.
 */
export async function encryptProvisionMessage(
  secondaryPublicKey: Uint8Array,
  message: Uint8Array<ArrayBuffer>,
  { ephemeralKey = wasm.PrivateKey_Generate(), iv = getRandomBytes(IV_LENGTH) }: {
    ephemeralKey?: wasm.PrivateKey; iv?: Uint8Array<ArrayBuffer>;
  } = {},
) {
  const agreement = wasm.PrivateKey_Agree(ephemeralKey, wasm.PublicKey_Deserialize(secondaryPublicKey));
  const secrets = deriveSecrets(KEY_LENGTH * 2, agreement, encodeUtf8(PROVISIONING_INFO), SALT);
  const ciphertext = await encryptAesCbc(secrets.slice(0, KEY_LENGTH), message, iv);
  const versionAndIv = concat(new Uint8Array([PROVISIONING_VERSION]), iv);
  const mac = await hmacSha256(secrets.slice(KEY_LENGTH), concat(versionAndIv, ciphertext));

  return toBinary(ProvisionEnvelopeSchema, create(ProvisionEnvelopeSchema, {
    publicKey: wasm.PublicKey_Serialize(wasm.PrivateKey_GetPublicKey(ephemeralKey)),
    body: concat(versionAndIv, ciphertext, mac),
  }));
}

async function decryptProvisionEnvelope(envelope: ProvisionEnvelope, ephemeralKey: wasm.PrivateKey) {
  const { publicKey, body } = envelope;
  if (!publicKey.length || !body.length) throw new Error('Invalid provisioning envelope');
  if (body[0] !== PROVISIONING_VERSION) throw new Error('Unknown provisioning message version');

  const iv = body.slice(1, 1 + IV_LENGTH);
  const ivAndCiphertext = body.slice(0, body.length - MAC_LENGTH);
  const ciphertext = body.slice(1 + IV_LENGTH, body.length - MAC_LENGTH);
  const mac = body.subarray(body.length - MAC_LENGTH);

  const agreement = wasm.PrivateKey_Agree(ephemeralKey, wasm.PublicKey_Deserialize(publicKey));
  const secrets = deriveSecrets(KEY_LENGTH * 2, agreement, encodeUtf8(PROVISIONING_INFO), SALT);
  const cipherKey = secrets.slice(0, KEY_LENGTH);
  const macKey = secrets.slice(KEY_LENGTH);

  await verifyHmacSha256(concat(ivAndCiphertext), macKey, mac, MAC_LENGTH);
  return fromBinary(ProvisionMessageSchema, await decryptAesCbc(cipherKey, ciphertext, iv));
}
