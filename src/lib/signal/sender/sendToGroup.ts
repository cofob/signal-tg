import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type { SenderKeyDevice, SenderKeyInfoRecord } from '../store/SignalStore';
import type { ContentHint, DeviceMismatch, RecipientResult, SenderContext } from './sendContent';

import { bufferToBase64 } from '../../../util/encoding/buffer';
import { padMessage } from '../crypto';
import { buildGroupSendToken, getAreGroupSendEndorsementsCurrent } from '../groups/groupSendEndorsements';
import { uuidToBytes } from '../serviceId';
import { getSenderKeyId } from '../store/protocolStores';
import { wasm } from '../wasm';
import { getSenderCertificate } from './sealedSender';
import { createAciStores, getSendDevices, sendToEach, UnregisteredUserError, updateDevices } from './sendContent';

import { parseJson } from '../net/ResourceSocket';
import { ContentSchema } from '../proto/generated/SignalService_pb';

export type GroupTarget = {
  // Group identifier (`GroupPublicParams_GetGroupIdentifier`)
  id: Uint8Array;
  secretParams: Uint8Array;
  // Fetches the group state again, which renews its send endorsements
  refresh(): Promise<void>;
};

type GroupSendOptions = {
  timestamp: number;
  contentHint: ContentHint;
  isOnline?: boolean;
  isUrgent?: boolean;
  isStory?: boolean;
};

/**
 * Who a sender key send goes to (Signal Desktop `SenderKeyTargetType`): the members of a group, or a story
 * distribution list, whose id is the distribution id of its sender key
 */
export type SenderKeyTarget =
  | { type: 'group'; group: GroupTarget }
  | { type: 'storyList'; listId: string };

type GroupSendResult = {
  results: RecipientResult[];
  // Members to send to one by one
  remaining: string[];
};

type MultiRecipientMismatch = { uuid: string; devices: DeviceMismatch }[];

// Signal Desktop `ts/util/sendToGroup.preload.ts`: `MAX_RECURSION` and the minimum sender key audience
const MAX_ATTEMPTS = 10;
const MIN_SENDER_KEY_RECIPIENTS = 2;
// Signal Android `RemoteConfig.senderKeyMaxAge` default
const SENDER_KEY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MULTI_RECIPIENT_CONTENT_TYPE = 'application/vnd.signal-messenger.mrm';
const HTTP_OK = 200;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
// The send fails instead of falling back to sends to each member, which would fail the same way
// (Signal Desktop `_shouldFailSend`)
const FATAL_STATUSES = new Set([400, 413, 428, 429, 500, 508]);
// Sender key infos of story distribution lists are stored next to those of groups, whose keys are base64 group ids
const STORY_LIST_INFO_PREFIX = 'storyList:';

// Sends to one group run one at a time, since each reads and updates its sender key info
const queues = new Map<string, Promise<unknown>>();

class MultiRecipientSendError extends Error {
  constructor(readonly status: number) {
    super(`Multi-recipient send failed with HTTP ${status}`);
  }
}

/**
 * Sends `content` to the group members that have send endorsements with one sealed sender multi-recipient
 * message encrypted with our sender key, after giving the key to the devices that lack it (Signal Desktop
 * `ts/util/sendToGroup.preload.ts`, `sendToGroupViaSenderKey`). Members without endorsements, and every
 * member when the sender key send cannot be used, are left for sends one by one. Stories need no endorsements:
 * the server takes them without authorization (`story` auth of libsignal-net).
 */
export function sendWithSenderKey(
  context: SenderContext,
  target: SenderKeyTarget,
  recipients: string[],
  content: MessageInitShape<typeof ContentSchema>,
  options: GroupSendOptions,
) {
  const infoKey = getSenderKeyInfoKey(target);
  // `sendQueued` does not reject
  const result = (queues.get(infoKey) ?? Promise.resolve())
    .then(() => sendQueued(context, target, infoKey, recipients, content, options));
  queues.set(infoKey, result);
  void result.then(() => {
    if (queues.get(infoKey) === result) queues.delete(infoKey);
  });
  return result;
}

/**
 * The sender key distribution message of the group, for a member that our current sender key reached,
 * so a retry request can give it the key again (Signal Desktop `ts/util/handleRetry.preload.ts`)
 */
export async function getSenderKeyDistributionMessage(
  context: SenderContext, groupId: Uint8Array, serviceId: string,
) {
  const { store, account } = context;
  const info = await store.getSenderKeyInfo(bufferToBase64(groupId));
  if (!info?.memberDevices.some((device) => device.serviceId === serviceId)) return undefined;

  const distributionId = uuidToBytes(info.distributionId);
  if (!await store.getSenderKey(getSenderKeyId(account.aci, account.deviceId, distributionId))) return undefined;
  return createDistributionMessage(context, info.distributionId);
}

async function sendQueued(
  context: SenderContext,
  target: SenderKeyTarget,
  infoKey: string,
  recipients: string[],
  content: MessageInitShape<typeof ContentSchema>,
  options: GroupSendOptions,
): Promise<GroupSendResult> {
  const failed: RecipientResult[] = [];
  try {
    return await sendWithRetries(context, target, infoKey, recipients, content, options, failed);
  } catch (err) {
    const remaining = recipients.filter((serviceId) => !failed.some((result) => result.serviceId === serviceId));
    if (err instanceof MultiRecipientSendError && FATAL_STATUSES.has(err.status)) {
      return { results: [...failed, ...remaining.map((serviceId) => ({ serviceId, error: err }))], remaining: [] };
    }
    return { results: failed, remaining };
  }
}

/**
 * Each step that changes the sender key info, the sessions or the endorsements starts over, as in Signal
 * Desktop. Members whose sender key distribution message fails are added to `failed`.
 */
async function sendWithRetries(
  context: SenderContext,
  target: SenderKeyTarget,
  infoKey: string,
  recipients: string[],
  content: MessageInitShape<typeof ContentSchema>,
  options: GroupSendOptions,
  failed: RecipientResult[],
): Promise<GroupSendResult> {
  const { store, account } = context;
  const plaintext = toBinary(ContentSchema, create(ContentSchema, content));
  const group = target.type === 'group' ? target.group : undefined;
  const isStory = Boolean(options.isStory);
  let didRefreshGroup = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const info = await getSenderKeyInfo(context, infoKey, target.type === 'storyList' ? target.listId : undefined);
    const candidates = recipients.filter((serviceId) => !failed.some((result) => result.serviceId === serviceId));

    // Endorsements that expire soon or miss members are renewed once with the group state; a failed refresh
    // keeps what we have (Signal Desktop `maybeCreateGroupSendEndorsementState`). Stories go without them.
    const endorsements = group && !isStory ? await store.getGroupSendEndorsements(infoKey) : undefined;
    const isCurrent = endorsements && getAreGroupSendEndorsementsCurrent(endorsements);
    if (group && !isStory && !didRefreshGroup
      && (!isCurrent || candidates.some((serviceId) => !endorsements.members[serviceId]))) {
      didRefreshGroup = true;
      await group.refresh().catch(() => undefined);
      continue;
    }

    const endorsed = isStory ? candidates : candidates.filter((serviceId) => endorsements?.members[serviceId]);
    const others = candidates.filter((serviceId) => !endorsed.includes(serviceId));
    if ((!isStory && !isCurrent) || endorsed.length < MIN_SENDER_KEY_RECIPIENTS) {
      return { results: failed, remaining: candidates };
    }

    const devices = await getMemberDevices(context, endorsed, failed);
    if (!devices) continue;

    const added = devices.filter((device) => !info.memberDevices.some((member) => isSameDevice(member, device)));
    const removed = info.memberDevices.filter((member) => !devices.some((device) => isSameDevice(member, device)));

    // A member left the group or the list: they must not read later messages. A group update also goes to removed
    // members, whom the endorsements of the new revision leave out.
    if (removed.some(({ serviceId }) => !recipients.includes(serviceId)
      || (endorsements && !endorsements.members[serviceId]))) {
      await resetSenderKey(context, infoKey, info);
      continue;
    }

    if (added.length) {
      const results = await sendToEach(context, [...new Set(added.map(({ serviceId }) => serviceId))], {
        senderKeyDistributionMessage: await createDistributionMessage(context, info.distributionId),
      }, {
        timestamp: Date.now(),
        contentHint: options.contentHint,
        groupId: group?.id,
        isUrgent: options.isUrgent,
        // Only the keys of distribution lists go as stories (Signal Desktop `sendContentMessageToGroup`)
        isStory: isStory && !group,
      });
      failed.push(...results.filter(({ error }) => error));
      const reached = added.filter((device) => results.some(({ serviceId, error }) => (
        serviceId === device.serviceId && !error
      )));
      await store.setSenderKeyInfo(infoKey, { ...info, memberDevices: [...info.memberDevices, ...reached] });
      continue;
    }

    if (removed.length) {
      await store.setSenderKeyInfo(infoKey, { ...info, memberDevices: info.memberDevices.filter((member) => (
        !removed.includes(member)
      )) });
    }

    const headers: Record<string, string> = { 'Content-Type': MULTI_RECIPIENT_CONTENT_TYPE };
    if (endorsements) {
      const token = buildGroupSendToken(endorsements, account.aci, group!.secretParams, endorsed);
      headers['Group-Send-Token'] = bufferToBase64(token);
    }
    const body = await encryptForSenderKey(
      context, info.distributionId, devices, plaintext, options.contentHint, group?.id,
    );
    const response = await context.unauthenticatedChat.sendRequest({
      verb: 'PUT',
      path: `/v1/messages/multi_recipient?ts=${options.timestamp}&online=${Boolean(options.isOnline)}`
        + `&urgent=${options.isUrgent ?? true}&story=${isStory}`,
      headers,
      body,
    });

    if (response.status === HTTP_OK) {
      const unregistered = parseJson<{ uuids404?: string[] }>(response.body)?.uuids404 ?? [];
      return {
        results: [...failed, ...endorsed.map((serviceId) => (unregistered.includes(serviceId)
          ? { serviceId, error: new UnregisteredUserError(serviceId) }
          : { serviceId, isSealedSender: true }))],
        remaining: others,
      };
    }

    if (response.status !== HTTP_CONFLICT && response.status !== HTTP_GONE) {
      throw new MultiRecipientSendError(response.status);
    }
    const mismatches = parseJson<MultiRecipientMismatch>(response.body);
    if (!mismatches) throw new MultiRecipientSendError(response.status);
    for (const { uuid, devices: mismatch } of mismatches) {
      await updateDevices(context, uuid, mismatch);
    }
    if (response.status === HTTP_GONE) await forgetStaleDevices(context, infoKey, mismatches);
  }

  throw new Error('The sender key send kept changing');
}

/**
 * Devices of `serviceIds` to send to, starting sessions where there are none. Unregistered members are
 * added to `failed`, and then the result is `undefined` so the send starts over without them.
 */
async function getMemberDevices(context: SenderContext, serviceIds: string[], failed: RecipientResult[]) {
  const devices: SenderKeyDevice[] = [];
  let isComplete = true;
  for (const serviceId of serviceIds) {
    try {
      devices.push(...await getSendDevices(context, serviceId));
    } catch (err) {
      if (!(err instanceof UnregisteredUserError)) throw err;
      failed.push({ serviceId, error: err });
      isComplete = false;
    }
  }
  return isComplete ? devices : undefined;
}

/** The key of a target's sender key info: the base64 group id, or the prefixed id of a distribution list */
function getSenderKeyInfoKey(target: SenderKeyTarget) {
  return target.type === 'group' ? bufferToBase64(target.group.id) : `${STORY_LIST_INFO_PREFIX}${target.listId}`;
}

/**
 * Creates the sender key info of a target, or resets it when it is too old. Groups get a random distribution id,
 * distribution lists use their own id (Signal Desktop `distributionListToSendTarget`).
 */
async function getSenderKeyInfo(context: SenderContext, infoKey: string, distributionId?: string) {
  const { store } = context;
  const info = await store.getSenderKeyInfo(infoKey);
  if (!info) {
    const created = { distributionId: distributionId ?? crypto.randomUUID(), createdAt: Date.now(), memberDevices: [] };
    await store.setSenderKeyInfo(infoKey, created);
    return created;
  }
  if (Date.now() - info.createdAt > SENDER_KEY_MAX_AGE_MS) return resetSenderKey(context, infoKey, info);
  return info;
}

/**
 * Drops our sender key, so the next distribution message carries a new one. The distribution id stays,
 * which keeps one sender key record per group on recipients (Signal Desktop `resetSenderKey`).
 */
async function resetSenderKey({ store, account }: SenderContext, infoKey: string, info: SenderKeyInfoRecord) {
  const reset = { distributionId: info.distributionId, createdAt: Date.now(), memberDevices: [] };
  await store.setSenderKeyInfo(infoKey, reset);
  await store.runExclusive(() => store.removeSenderKey(
    getSenderKeyId(account.aci, account.deviceId, uuidToBytes(info.distributionId)),
  ));
  return reset;
}

/** Re-registered or re-linked devices need our sender key again (Signal Desktop `handle410Response`) */
async function forgetStaleDevices(context: SenderContext, infoKey: string, mismatches: MultiRecipientMismatch) {
  const info = (await context.store.getSenderKeyInfo(infoKey))!;
  await context.store.setSenderKeyInfo(infoKey, {
    ...info,
    memberDevices: info.memberDevices.filter((member) => !mismatches.some(({ uuid, devices }) => (
      uuid === member.serviceId && devices.staleDevices?.includes(member.deviceId)
    ))),
  });
}

async function createDistributionMessage(context: SenderContext, distributionId: string) {
  const { store, account } = context;
  const stores = await createAciStores(context);
  return store.runExclusive(async () => {
    const message = await wasm.SenderKeyDistributionMessage_Create(
      wasm.ProtocolAddress_New(account.aci, account.deviceId), uuidToBytes(distributionId), stores.senderKey,
    ) as wasm.SenderKeyDistributionMessage;
    return wasm.SenderKeyDistributionMessage_Serialize(message);
  });
}

/**
 * Encrypts the content once with our sender key and wraps it in a sealed sender message for every device
 * (Signal Desktop `encryptForSenderKey`)
 */
async function encryptForSenderKey(
  context: SenderContext,
  distributionId: string,
  devices: SenderKeyDevice[],
  plaintext: Uint8Array,
  contentHint: ContentHint,
  groupId?: Uint8Array,
) {
  const { store, account, connection } = context;
  const certificate = await getSenderCertificate(store, connection);
  const stores = await createAciStores(context);

  return store.runExclusive(async () => {
    const ciphertext = await wasm.GroupCipher_EncryptMessage(
      wasm.ProtocolAddress_New(account.aci, account.deviceId),
      uuidToBytes(distributionId),
      padMessage(plaintext),
      stores.senderKey,
    ) as wasm.CiphertextMessage;
    const usmc = wasm.UnidentifiedSenderMessageContent_New(ciphertext, certificate, contentHint, groupId);

    // Devices of one member are next to each other, so libsignal encodes their shared key material once
    const addresses = devices.map(({ serviceId, deviceId }) => wasm.ProtocolAddress_New(serviceId, deviceId));
    const sessions = [];
    for (const { serviceId, deviceId } of devices) {
      sessions.push(wasm.SessionRecord_Deserialize((await store.getSession(`${serviceId}.${deviceId}`))!));
    }
    return await wasm.SealedSender_MultiRecipientEncrypt(
      addresses, sessions, new Uint8Array(), usmc, stores.identity,
    ) as Uint8Array;
  });
}

/** Registration ids tell a re-registered device apart (Signal Desktop `deviceComparator`) */
function isSameDevice(a: SenderKeyDevice, b: SenderKeyDevice) {
  return a.serviceId === b.serviceId && a.deviceId === b.deviceId && a.registrationId === b.registrationId;
}
