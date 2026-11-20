import { SIGNAL_CHAT_HOST } from '../config';
import { bufferToBase64, concat } from '../../../util/encoding/buffer';
import { decryptAesCbc, deriveSecrets, encodeUtf8, verifyHmacSha256 } from '../crypto';
import { wasm } from '../wasm';

import ResourceSocket from '../net/ResourceSocket';
import { ProvisionEnvelope } from '../proto/generated/ProvisionEnvelope';
import { ProvisioningAddress, ProvisionMessage } from '../proto/generated/Provisioning';

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
// `backup5` (link and sync) is added once message history import is supported
const LINK_CAPABILITIES = ['nopni', 'nopni2'];
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
        const { address } = ProvisioningAddress.decode(request.body);
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
        decryptProvisionEnvelope(ProvisionEnvelope.decode(request.body), ephemeralKey)
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

async function decryptProvisionEnvelope(envelope: ProvisionEnvelope, ephemeralKey: wasm.PrivateKey) {
  const { publicKey, body } = envelope;
  if (!publicKey || !body) throw new Error('Invalid provisioning envelope');
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
  return ProvisionMessage.decode(await decryptAesCbc(cipherKey, ciphertext, iv));
}
