import { fromBinary } from '@bufbuild/protobuf';

import type MessageProcessor from '../messages/MessageProcessor';
import type { Credentials } from '../net/rest';
import type { SenderContext } from '../sender/sendContent';

import { SIGNAL_PRIMARY_DEVICE_ID } from '../config';
import { bufferToBase64 } from '../../../util/encoding/buffer';
import { sendFetchLatestSync, sendUsernameChangeSync } from '../sender/sendMessage';
import {
  fetchManifest, fetchRecords, getStorageCredentials, getStorageKey, ManifestDecryptError, writeManifest,
} from './storageService';

import { SyncMessage_FetchLatest_Type } from '../proto/generated/SignalService_pb';
import { ManifestRecordSchema } from '../proto/generated/StorageService_pb';

type PendingWrite = Awaited<ReturnType<MessageProcessor['buildNewStorageWrite']>>;

// Signal Desktop `conflictBackOff` in `ts/services/storage.preload.ts` gives up after three conflicts in a row
const MAX_WRITE_ATTEMPTS = 3;
// Signal Android starts the manifests of a new account at this version
const FIRST_MANIFEST_VERSION = 1n;

/**
 * Syncs the storage service (Signal Desktop `sync` and `upload` in `ts/services/storage.preload.ts`): merges a
 * newer manifest and the records new to this device, then writes the local changes on top of it. A write that
 * conflicts with another device's write starts over from the newer manifest. After a write, our other devices are
 * asked to fetch it, and told about a new username. A primary device that finds no manifest creates one from its
 * state, and starts over with a new one when the manifest on the server is not encrypted with its storage key.
 */
export async function syncStorageService(context: SenderContext, processor: MessageProcessor) {
  const storageKey = await getStorageKey(context.account);
  const credentials = await getStorageCredentials(context.connection);
  const isPrimary = context.account.deviceId === SIGNAL_PRIMARY_DEVICE_ID;

  for (let attempt = 1; ; attempt++) {
    const stored = await context.store.getItem('storageManifest');
    const local = stored && fromBinary(ManifestRecordSchema, stored);

    let remote;
    let newManifest: { version: bigint; shouldClearAll: boolean } | undefined;
    try {
      remote = await fetchManifest(credentials, storageKey, local?.version);
      if (!remote && !local && isPrimary) newManifest = { version: FIRST_MANIFEST_VERSION, shouldClearAll: false };
    } catch (err) {
      if (!isPrimary || !(err instanceof ManifestDecryptError)) throw err;
      newManifest = { version: err.version + 1n, shouldClearAll: true };
    }

    if (newManifest) {
      const pending = await processor.buildNewStorageWrite(newManifest.version, newManifest.shouldClearAll);
      if (await writeAndAnnounce(context, processor, credentials, storageKey, pending)) return;
    } else {
      if (remote) {
        const knownIds = new Set(local?.identifiers.map(({ raw }) => bufferToBase64(raw)));
        const newIds = remote.identifiers.map(({ raw }) => bufferToBase64(raw)).filter((id) => !knownIds.has(id));
        const records = await fetchRecords(credentials, storageKey, remote.recordIkm, newIds);
        await processor.applyStorageManifest(remote, records);
      }

      const pending = await processor.buildStorageWrite();
      if (!pending) return;
      if (await writeAndAnnounce(context, processor, credentials, storageKey, pending)) return;
    }
    if (attempt === MAX_WRITE_ATTEMPTS) throw new Error(`Storage service writes conflicted ${attempt} times`);
  }
}

/** Writes the manifest; once the server accepts it, stores it and tells our other devices. `false` means a conflict. */
async function writeAndAnnounce(
  context: SenderContext,
  processor: MessageProcessor,
  credentials: Credentials,
  storageKey: Uint8Array<ArrayBuffer>,
  pending: PendingWrite,
) {
  if (!await writeManifest(credentials, storageKey, pending.write)) return false;

  await processor.commitStorageWrite(pending);
  await sendFetchLatestSync(context, SyncMessage_FetchLatest_Type.STORAGE_MANIFEST);
  // Only once the record has the new username, or the primary device would find it out of sync
  if (pending.hasUsernameChange) await sendUsernameChangeSync(context);
  return true;
}
