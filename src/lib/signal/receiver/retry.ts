import { fromBinary } from '@bufbuild/protobuf';

import type { SenderContext } from '../sender/sendContent';
import type SignalStore from '../store/SignalStore';
import type { DecryptionError } from './decryptEnvelope';

import { ContentHint, sendContent } from '../sender/sendContent';
import { sendNullMessage } from '../sender/sendMessage';
import { wasm } from '../wasm';

import { ContentSchema } from '../proto/generated/SignalService_pb';

const RETRY_LIMIT = 5;

const retryCounts = new Map<string, number>();

/**
 * Asks the sender of an envelope we failed to decrypt to send it again with a `DecryptionErrorMessage`
 * (Signal Desktop `ts/util/handleRetry.preload.ts`, `requestResend`)
 */
export async function requestResend(context: SenderContext, { details }: DecryptionError) {
  const { senderServiceId, senderDeviceId, timestamp } = details;
  if (!countRetry(`${senderServiceId}.${senderDeviceId} ${timestamp}`)) return;

  const message = wasm.DecryptionErrorMessage_ForOriginalMessage(
    details.ciphertext, details.messageType, timestamp, senderDeviceId,
  );
  await sendContent(context, senderServiceId, wasm.PlaintextContent_FromDecryptionErrorMessage(message), {
    timestamp, contentHint: ContentHint.Default, groupId: details.groupId, isUrgent: false,
  });
}

/**
 * Answers a `DecryptionErrorMessage` about a message this device sent: archives the session it names,
 * then resends the message if it is still in the sent log, or sends a null message to start a new session
 * (Signal Desktop `ts/util/handleRetry.preload.ts`, `onRetryRequest`)
 */
export async function handleRetryRequest(
  context: SenderContext, senderServiceId: string, senderDeviceId: number, message: Uint8Array,
) {
  const request = wasm.DecryptionErrorMessage_Deserialize(message);
  if (wasm.DecryptionErrorMessage_GetDeviceId(request) !== context.account.deviceId) return;

  const timestamp = wasm.DecryptionErrorMessage_GetTimestamp(request);
  if (!countRetry(`${senderServiceId}.${senderDeviceId} ${timestamp}`)) return;

  const isArchived = await archiveSessionOnMatch(
    context.store, `${senderServiceId}.${senderDeviceId}`, wasm.DecryptionErrorMessage_GetRatchetKey(request),
  );

  const sentProto = await context.store.getSentProto(timestamp);
  if (sentProto?.recipients.includes(senderServiceId)) {
    await sendContent(context, senderServiceId, fromBinary(ContentSchema, sentProto.content), {
      timestamp,
      contentHint: sentProto.contentHint,
      groupId: sentProto.groupId,
      isUrgent: sentProto.isUrgent,
    });
    return;
  }

  if (isArchived) await sendNullMessage(context, senderServiceId);
}

async function archiveSessionOnMatch(store: SignalStore, address: string, ratchetKey?: wasm.PublicKey) {
  if (!ratchetKey) return false;

  return store.runExclusive(async () => {
    const serialized = await store.getSession(address);
    if (!serialized) return false;

    const record = wasm.SessionRecord_Deserialize(serialized);
    if (!wasm.SessionRecord_CurrentRatchetKeyMatches(record, ratchetKey)) return false;
    wasm.SessionRecord_ArchiveCurrentState(record);
    await store.setSession(address, wasm.SessionRecord_Serialize(record));
    return true;
  });
}

function countRetry(key: string) {
  const count = (retryCounts.get(key) ?? 0) + 1;
  retryCounts.set(key, count);
  return count <= RETRY_LIMIT;
}
