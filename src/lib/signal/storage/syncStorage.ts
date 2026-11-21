import { fromBinary } from '@bufbuild/protobuf';

import type MessageProcessor from '../messages/MessageProcessor';
import type { SenderContext } from '../sender/sendContent';

import { bufferToBase64 } from '../../../util/encoding/buffer';
import { sendFetchLatestSync, sendUsernameChangeSync } from '../sender/sendMessage';
import {
  fetchManifest, fetchRecords, getStorageCredentials, getStorageKey, writeManifest,
} from './storageService';

import { SyncMessage_FetchLatest_Type } from '../proto/generated/SignalService_pb';
import { ManifestRecordSchema } from '../proto/generated/StorageService_pb';

// Signal Desktop `conflictBackOff` in `ts/services/storage.preload.ts` gives up after three conflicts in a row
const MAX_WRITE_ATTEMPTS = 3;

/**
 * Syncs the storage service (Signal Desktop `sync` and `upload` in `ts/services/storage.preload.ts`): merges a
 * newer manifest and the records new to this device, then writes the local changes on top of it. A write that
 * conflicts with another device's write starts over from the newer manifest. After a write, our other devices are
 * asked to fetch it, and told about a new username.
 */
export async function syncStorageService(context: SenderContext, processor: MessageProcessor) {
  const storageKey = await getStorageKey(context.account);
  const credentials = await getStorageCredentials(context.connection);

  for (let attempt = 1; ; attempt++) {
    const stored = await context.store.getItem('storageManifest');
    const local = stored && fromBinary(ManifestRecordSchema, stored);
    const remote = await fetchManifest(credentials, storageKey, local?.version);
    if (remote) {
      const knownIds = new Set(local?.identifiers.map(({ raw }) => bufferToBase64(raw)));
      const newIds = remote.identifiers.map(({ raw }) => bufferToBase64(raw)).filter((id) => !knownIds.has(id));
      const records = await fetchRecords(credentials, storageKey, remote.recordIkm, newIds);
      await processor.applyStorageManifest(remote, records);
    }

    const pending = await processor.buildStorageWrite();
    if (!pending) return;
    if (await writeManifest(credentials, storageKey, pending.write)) {
      await processor.commitStorageWrite(pending);
      await sendFetchLatestSync(context, SyncMessage_FetchLatest_Type.STORAGE_MANIFEST);
      // Only once the record has the new username, or the primary device would find it out of sync
      if (pending.hasUsernameChange) await sendUsernameChangeSync(context);
      return;
    }
    if (attempt === MAX_WRITE_ATTEMPTS) throw new Error(`Storage service writes conflicted ${attempt} times`);
  }
}
