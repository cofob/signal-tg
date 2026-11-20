/* eslint-disable no-console */
import type { DecryptedEnvelope } from '../receiver/decryptEnvelope';

import { bufferFromBase64 } from '../../../util/encoding/buffer';
import { createStyledQrCode } from '../../../util/qrCode/buildStyledQrCode';
import { linkDevice } from '../account/linkDevice';
import { startDeviceLink } from '../account/provisioning';
import { downloadAttachment } from '../attachments/downloadAttachment';
import { fetchGroup } from '../groups/fetchGroup';
import { fetchProfile } from '../profiles/fetchProfile';
import { sendContent } from '../sender/sendContent';
import { sendInitialSyncRequests } from '../sender/syncRequests';
import { fetchStorageSnapshot } from '../storage/storageService';
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
    await sendContent(context, destination, { content: { case: 'dataMessage', value: message } }, { timestamp });
    const sent = { destinationServiceId: destination, timestamp: BigInt(timestamp), message };
    await sendContent(context, account.aci, {
      content: { case: 'syncMessage', value: { content: { case: 'sent', value: sent } } },
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

  /** Reads the storage service and prints record counts and contacts */
  async syncStorage() {
    const account = await store.getItem('account');
    if (!account || !connection) throw new Error('Not connected: call signalDev.listen() first');

    const snapshot = await fetchStorageSnapshot(account, connection);
    if (!snapshot) {
      console.log('[signal] Storage service has no manifest yet');
      return;
    }
    const records = [...snapshot.records.values()];
    const countsByType: Record<string, number> = {};
    for (const { record } of records) {
      const type = record.case ?? 'unknown';
      countsByType[type] = (countsByType[type] ?? 0) + 1;
    }
    console.log(`[signal] Storage manifest version ${snapshot.version}:`, countsByType);
    console.table(records.flatMap(({ record }) => (record.case === 'contact' ? [record.value] : [])).map((contact) => ({
      aci: contact.aci,
      e164: contact.e164,
      name: [contact.systemGivenName || contact.givenName, contact.systemFamilyName || contact.familyName]
        .filter(Boolean).join(' '),
      archived: contact.archived,
    })));
  },

  /** Fetches every group v2 listed in the storage service and prints titles and members */
  async groups() {
    const account = await store.getItem('account');
    if (!account || !connection) throw new Error('Not connected: call signalDev.listen() first');

    const snapshot = await fetchStorageSnapshot(account, connection);
    const masterKeys = [...snapshot?.records.values() ?? []].flatMap(({ record }) => (
      record.case === 'groupV2' && record.value.masterKey.length ? [record.value.masterKey] : []
    ));
    const rows = [];
    for (const masterKey of masterKeys) {
      try {
        const group = await fetchGroup(account, connection, masterKey);
        rows.push({
          title: group.title, revision: group.revision, members: group.members.length, groupId: group.groupId,
        });
      } catch (err) {
        rows.push({ title: `Failed: ${(err as Error).message}` });
      }
    }
    console.table(rows);
  },

  /** Prints a decrypted profile; defaults to our own */
  async profile(aci?: string, profileKeyBase64?: string) {
    const account = await store.getItem('account');
    if (!account || !connection) throw new Error('Not connected: call signalDev.listen() first');

    const profileKey = profileKeyBase64 ? bufferFromBase64(profileKeyBase64) : account.profileKey;
    if (!profileKey) throw new Error('No profile key');
    const profile = await fetchProfile(connection, aci ?? account.aci, profileKey);
    console.log('[signal] Profile', profile);
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
  const body = content.content;

  if (body.case === 'dataMessage') {
    console.log(`[signal] Message from ${from}:`, body.value.body, body.value);
    return;
  }
  if (body.case !== 'syncMessage') {
    console.log(`[signal] Content from ${from}:`, content);
    return;
  }

  const sync = body.value.content;
  switch (sync.case) {
    case 'keys': {
      const keys = sync.value;
      void store.getItem('account').then((account) => account && store.setItem('account', {
        ...account,
        accountEntropyPool: keys.accountEntropyPool || account.accountEntropyPool,
        mediaRootBackupKey: keys.mediaRootBackupKey.length ? keys.mediaRootBackupKey : account.mediaRootBackupKey,
      }));
      console.log('[signal] Received account keys from the primary device');
      break;
    }
    case 'contacts':
      if (!sync.value.blob) break;
      void downloadAttachment(sync.value.blob).then((data) => {
        const contacts = parseContactSync(data);
        console.log(`[signal] Contact sync: ${contacts.length} contacts`);
        console.table(contacts.map(({ aci, number, name }) => ({ aci, number, name })));
      }, (err) => console.warn('[signal] Contact sync download failed', err));
      break;
    case 'sent':
      console.log(`[signal] Sent from another device of ours to ${sync.value.destinationServiceId}:`,
        sync.value.message?.body, sync.value);
      break;
    default:
      console.log(`[signal] Sync message from ${from}:`, sync);
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
