/* eslint-disable no-console */
import type { DecryptedEnvelope } from '../receiver/decryptEnvelope';

import { createStyledQrCode } from '../../../util/qrCode/buildStyledQrCode';
import { linkDevice } from '../account/linkDevice';
import { startDeviceLink } from '../account/provisioning';
import { downloadAttachment } from '../attachments/downloadAttachment';
import { sendContent } from '../sender/sendContent';
import { sendInitialSyncRequests } from '../sender/syncRequests';
import { parseContactSync } from '../sync/contactSync';
import { initSignalWasm } from '../wasm';

import ChatConnection from '../chat/ChatConnection';
import SignalStore from '../store/SignalStore';

const QR_SIZE = 300;
const DEFAULT_DEVICE_NAME = 'TeleSignal';

const store = new SignalStore();
let connection: ChatConnection | undefined;

/**
 * Development console API for the Signal engine, until the app UI uses it:
 * `await signalDev.link()` shows a QR code to scan in Signal on the phone, links this browser and starts
 * printing decrypted messages; `signalDev.listen()` reconnects later; `signalDev.reset()` forgets the device.
 */
const signalDev = {
  async link(deviceName = DEFAULT_DEVICE_NAME) {
    await initSignalWasm();
    const session = await startDeviceLink();
    await printQrCode(session.url);
    console.log('[signal] Scan the QR code in Signal: Settings > Linked devices > Link new device');
    console.log('[signal] Link URL:', session.url);

    const account = await linkDevice(store, await session.provisionMessage, deviceName);
    console.log(`[signal] Linked as device ${account.deviceId} of ${account.aci}`);
    await signalDev.listen();
    await sendInitialSyncRequests({ store, account, connection: connection! });
    console.log('[signal] Sent sync requests for contacts, configuration and blocked list');
  },

  /** Sends a text message to an ACI and a sent transcript to our other devices */
  async sendText(destination: string, text: string) {
    const account = await store.getItem('account');
    if (!account || !connection) throw new Error('Not connected: call signalDev.listen() first');

    const context = { store, account, connection };
    const timestamp = Date.now();
    const message = { body: text, timestamp: BigInt(timestamp) };
    await sendContent(context, destination, { dataMessage: message }, { timestamp });
    await sendContent(context, account.aci, {
      syncMessage: { sent: { destinationServiceId: destination, timestamp: BigInt(timestamp), message } },
    }, { timestamp });
    console.log('[signal] Sent', timestamp);
  },

  async listen() {
    await initSignalWasm();
    const account = await store.getItem('account');
    if (!account) throw new Error('Not linked: call signalDev.link() first');

    connection?.close();
    connection = await ChatConnection.connect(store, account, {
      onEnvelope: printEnvelope,
      onDeliveryReceipt: (envelope) => console.log('[signal] Delivery receipt', envelope.clientTimestamp),
      onDecryptionError: (envelope, err) => console.warn('[signal] Decryption failed', envelope, err),
      onQueueEmpty: () => console.log('[signal] Queue drained'),
      onClose: (code, reason) => console.log('[signal] Chat socket closed', code, reason),
    });
    console.log('[signal] Connected to the chat socket');
  },

  async reset() {
    connection?.close();
    connection = undefined;
    await store.clear();
    console.log('[signal] Local Signal data removed; unlink the device on the phone too');
  },
};

function printEnvelope({ senderServiceId, senderDeviceId, content }: DecryptedEnvelope) {
  const from = `${senderServiceId}.${senderDeviceId}`;
  const sent = content.syncMessage?.sent?.message;
  const contactsBlob = content.syncMessage?.contacts?.blob;
  if (contactsBlob) {
    void downloadAttachment(contactsBlob).then((data) => {
      const contacts = parseContactSync(data);
      console.log(`[signal] Contact sync: ${contacts.length} contacts`);
      console.table(contacts.map(({ aci, number, name }) => ({ aci, number, name })));
    }, (err) => console.warn('[signal] Contact sync download failed', err));
  } else if (content.dataMessage) {
    console.log(`[signal] Message from ${from}:`, content.dataMessage.body ?? '', content.dataMessage);
  } else if (sent) {
    console.log(`[signal] Sent from another device of ours to ${content.syncMessage!.sent!.destinationServiceId}:`,
      sent.body ?? '', sent);
  } else {
    console.log(`[signal] Content from ${from}:`, content);
  }
}

async function printQrCode(url: string) {
  const qrCode = await createStyledQrCode({ size: QR_SIZE });
  qrCode.update({ data: url, type: 'canvas' });
  const blob = await qrCode.getRawData('png') as Blob;
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  console.log(
    '%c ',
    `padding: ${QR_SIZE / 2}px; background: url(${dataUrl}) no-repeat center / contain, #fff;`,
  );
}

Object.assign(window, { signalDev });
