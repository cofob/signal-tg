/* eslint-disable no-console */
import type { DecryptedEnvelope } from '../receiver/decryptEnvelope';

import { bufferFromBase64 } from '../../../util/encoding/buffer';
import { createStyledQrCode } from '../../../util/qrCode/buildStyledQrCode';
import { linkDevice } from '../account/linkDevice';
import { startDeviceLink } from '../account/provisioning';
import { downloadAttachment } from '../attachments/downloadAttachment';
import { fetchGroup } from '../groups/fetchGroup';
import { fetchProfile } from '../profiles/fetchProfile';
import { saveProfileKey } from '../sender/sealedSender';
import { sendMessage } from '../sender/sendMessage';
import { sendInitialSyncRequests } from '../sender/syncRequests';
import { fetchStorageSnapshot } from '../storage/storageService';
import { parseContactSync } from '../sync/contactSync';
import { initSignalWasm, wasm } from '../wasm';

import SignalClient from '../SignalClient';
import SignalStore from '../store/SignalStore';

const QR_SIZE = 300;
const DEFAULT_DEVICE_NAME = 'TeleSignal';

const store = new SignalStore();
const client = new SignalClient(store);
// Master keys of the groups that `signalDev.groups()` listed, by group id
const groupMasterKeys = new Map<string, Uint8Array>();
let isConnected = false;

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
    await sendInitialSyncRequests(client.getSenderContext());
    console.log('[signal] Sent sync requests for contacts, configuration and blocked list');
  },

  /**
   * Sends a text message to an ACI and a sent transcript to our other devices. Run `signalDev.syncStorage()`
   * first so the recipient's profile key allows a sealed sender send.
   */
  async sendText(destination: string, text: string) {
    const context = getContext();
    const timestamp = Date.now();
    const [result] = await sendMessage(context, [destination], {
      case: 'dataMessage',
      value: { body: text, timestamp: BigInt(timestamp), profileKey: context.account.profileKey },
    }, { timestamp });
    if (result.error) throw result.error;
    console.log('[signal] Sent', timestamp, result.isSealedSender ? 'with sealed sender' : 'identified');
  },

  /** Sends a text message to every member of a group that `signalDev.groups()` listed */
  async sendGroupText(groupId: string, text: string) {
    const context = getContext();
    const masterKey = groupMasterKeys.get(groupId);
    if (!masterKey) throw new Error('Unknown group: call signalDev.groups() first');

    const group = await fetchGroup(context.account, context.connection, masterKey);
    const timestamp = Date.now();
    const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
    const results = await sendMessage(context, group.members.map(({ aci }) => aci), {
      case: 'dataMessage',
      value: {
        body: text,
        timestamp: BigInt(timestamp),
        profileKey: context.account.profileKey,
        groupV2: { masterKey, revision: group.revision },
      },
    }, {
      timestamp,
      groupId: wasm.GroupPublicParams_GetGroupIdentifier(wasm.GroupSecretParams_GetPublicParams(secretParams)),
    });
    console.table(results.map(({ serviceId, isSealedSender, error }) => ({
      serviceId, isSealedSender, error: error?.message,
    })));
  },

  async listen() {
    await client.connect({
      onContent: printEnvelope,
      onDeliveryReceipt: (envelope) => console.log('[signal] Delivery receipt', envelope.clientTimestamp),
      onDecryptionError: (envelope, err) => console.warn('[signal] Decryption failed', envelope, err),
      onQueueEmpty: () => console.log('[signal] Queue drained'),
      onClose: (code, reason) => {
        isConnected = false;
        console.log('[signal] Chat socket closed', code, reason);
      },
      onError: (err) => console.error('[signal]', err),
    });
    isConnected = true;
    console.log('[signal] Connected to the chat socket');
  },

  /** Reads the storage service and prints record counts and contacts */
  async syncStorage() {
    const { account, connection } = getContext();
    const snapshot = await fetchStorageSnapshot(account, connection);
    if (!snapshot) {
      console.log('[signal] Storage service has no manifest yet');
      return;
    }
    const records = [...snapshot.records.values()];
    for (const { record } of records) {
      if (record.case === 'contact' && record.value.aci && record.value.profileKey.length) {
        await saveProfileKey(store, record.value.aci, record.value.profileKey);
      }
    }
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
    const { account, connection } = getContext();
    const snapshot = await fetchStorageSnapshot(account, connection);
    const masterKeys = [...snapshot?.records.values() ?? []].flatMap(({ record }) => (
      record.case === 'groupV2' && record.value.masterKey.length ? [record.value.masterKey] : []
    ));
    const rows = [];
    for (const masterKey of masterKeys) {
      try {
        const group = await fetchGroup(account, connection, masterKey);
        groupMasterKeys.set(group.groupId, masterKey);
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
    const { account, connection } = getContext();

    const profileKey = profileKeyBase64 ? bufferFromBase64(profileKeyBase64) : account.profileKey;
    if (!profileKey) throw new Error('No profile key');
    const profile = await fetchProfile(connection, aci ?? account.aci, profileKey);
    console.log('[signal] Profile', profile);
  },

  async reset() {
    client.close();
    isConnected = false;
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

function getContext() {
  if (!isConnected) throw new Error('Not connected: call signalDev.listen() first');
  return client.getSenderContext();
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
