import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type {
  DataMessageSchema,
  EditMessageSchema,
  ReceiptMessage_Type,
  StoryMessageSchema,
  SyncMessage_BlockedSchema,
  SyncMessage_DeleteForMeSchema,
  SyncMessage_FetchLatest_Type,
  SyncMessage_MessageRequestResponseSchema,
  SyncMessage_Sent_StoryMessageRecipientSchema,
} from '../proto/generated/SignalService_pb';
import type { RecipientResult, SenderContext, SendOptions, SendResult } from './sendContent';
import type { GroupTarget, SenderKeyTarget } from './sendToGroup';

import { SIGNAL_PRIMARY_DEVICE_ID } from '../config';
import { getRandomPadding } from '../crypto';
import { ContentHint, sendContent, sendToEach } from './sendContent';
import { sendWithSenderKey } from './sendToGroup';

import { ContentSchema, SyncMessageSchema, TypingMessage_Action } from '../proto/generated/SignalService_pb';

export type OutgoingMessage =
  | { case: 'dataMessage'; value: MessageInitShape<typeof DataMessageSchema> }
  | { case: 'editMessage'; value: MessageInitShape<typeof EditMessageSchema> };

type MessageOptions = {
  timestamp: number;
  group?: GroupTarget;
  expirationStartTimestamp?: number;
  // Group story replies go as stories (Signal Desktop `sendNormalMessage`)
  isStory?: boolean;
};

export type StoryMessageRecipient = MessageInitShape<typeof SyncMessage_Sent_StoryMessageRecipientSchema>;

const SENT_PROTO_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SENT_PROTO_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

let lastSentProtoPruneAt = 0;

/**
 * Sends a data or edit message to its recipients (group messages with sender key where possible), then a
 * sent transcript to our other devices, and keeps the content for a day so recipients can ask for a resend
 * (Signal Desktop `ts/textsecure/SendMessage.preload.ts`). A message to ourselves sends only the transcript.
 */
export async function sendMessage(
  context: SenderContext, recipients: string[], message: OutgoingMessage, options: MessageOptions,
) {
  const { store, account } = context;
  const others = recipients.filter((serviceId) => serviceId !== account.aci);
  const content = { content: message };
  const groupId = options.group?.id;
  const results = await sendToRecipients(context, others, content, {
    timestamp: options.timestamp, contentHint: ContentHint.Resendable, groupId, isStory: options.isStory,
  }, options.group);

  await store.addSentProto({
    timestamp: options.timestamp,
    content: toBinary(ContentSchema, create(ContentSchema, content)),
    contentHint: ContentHint.Resendable,
    recipients: others,
    groupId,
    isUrgent: true,
    savedAt: Date.now(),
  });

  if (!others.length || results.some(({ error }) => !error)) {
    await syncToOtherDevices(context, {
      content: {
        case: 'sent',
        value: {
          destinationServiceId: !groupId ? others[0] : undefined,
          timestamp: BigInt(options.timestamp),
          message: message.case === 'dataMessage' ? message.value : undefined,
          editMessage: message.case === 'editMessage' ? message.value : undefined,
          expirationStartTimestamp: options.expirationStartTimestamp !== undefined
            ? BigInt(options.expirationStartTimestamp)
            : undefined,
          unidentifiedStatus: results.filter(({ error }) => !error).map(({ serviceId, isSealedSender }) => ({
            destinationServiceId: serviceId,
            unidentified: isSealedSender,
          })),
        },
      },
    }, options.timestamp);
  }

  if (Date.now() - lastSentProtoPruneAt > SENT_PROTO_PRUNE_INTERVAL_MS) {
    lastSentProtoPruneAt = Date.now();
    await store.removeSentProtosBefore(Date.now() - SENT_PROTO_MAX_AGE_MS);
  }
  return results;
}

/**
 * Sends a story to its recipients with the sender key of a distribution list or a group, and one by one where that
 * does not work (Signal Desktop `ts/jobs/helpers/sendStory.preload.ts`). Stories are not urgent and are not resent
 * after decryption errors, so they stay out of the sent log; the sync with every list goes separately
 * (`sendStorySync`).
 */
export async function sendStory(
  context: SenderContext,
  recipients: string[],
  storyMessage: MessageInitShape<typeof StoryMessageSchema>,
  { timestamp, target }: { timestamp: number; target: SenderKeyTarget },
): Promise<RecipientResult[]> {
  const others = recipients.filter((serviceId) => serviceId !== context.account.aci);
  const content = { content: { case: 'storyMessage' as const, value: storyMessage } };
  const options = {
    timestamp, contentHint: ContentHint.Implicit, isUrgent: false, isStory: true,
  };
  const { results, remaining } = await sendWithSenderKey(context, target, others, content, options);
  return [...results, ...await sendToEach(context, remaining, content, {
    ...options, groupId: target.type === 'group' ? target.group.id : undefined,
  })];
}

/**
 * Tells our other devices about a story we sent, with each recipient's distribution lists and whether they may
 * reply. `isRecipientUpdate` without a story changes who has an earlier story; a story nobody has any more is
 * deleted (Signal Desktop `onStoryRecipientUpdate`).
 */
export function sendStorySync(context: SenderContext, {
  timestamp, storyMessage, storyMessageRecipients, isRecipientUpdate,
}: {
  timestamp: number;
  storyMessage?: MessageInitShape<typeof StoryMessageSchema>;
  storyMessageRecipients: StoryMessageRecipient[];
  isRecipientUpdate?: boolean;
}) {
  return syncToOtherDevices(context, {
    content: {
      case: 'sent',
      value: {
        // Distribution list stories name our own conversation, group stories none (Signal Desktop `sendStory`)
        destinationServiceId: storyMessage?.group ? undefined : context.account.aci,
        timestamp: BigInt(timestamp),
        storyMessage,
        storyMessageRecipients,
        isRecipientUpdate,
      },
    },
  }, timestamp);
}

/** Deletes a distribution list story for its recipients (Signal Desktop `sendDeleteStoryForEveryone`) */
export function sendStoryDelete(context: SenderContext, recipients: string[], targetSentAt: number) {
  const timestamp = Date.now();
  return sendToEach(context, recipients, {
    content: {
      case: 'dataMessage',
      value: { delete: { targetSentTimestamp: BigInt(targetSentAt) }, timestamp: BigInt(timestamp) },
    },
  }, { timestamp, contentHint: ContentHint.Resendable, isStory: true });
}

/** Sends delivery, read or viewed receipts for messages of one sender */
export function sendReceipts(
  context: SenderContext, senderAci: string, type: ReceiptMessage_Type, timestamps: number[],
) {
  return sendContent(context, senderAci, {
    content: { case: 'receiptMessage', value: { type, timestamp: timestamps.map(BigInt) } },
  }, { timestamp: Date.now(), contentHint: ContentHint.Resendable, isUrgent: false });
}

/** Sends a typing indicator; it is delivered only to devices online now */
export function sendTyping(
  context: SenderContext, recipients: string[], isTyping: boolean, group?: GroupTarget,
) {
  const timestamp = Date.now();
  return sendToRecipients(context, recipients.filter((serviceId) => serviceId !== context.account.aci), {
    content: {
      case: 'typingMessage',
      value: {
        timestamp: BigInt(timestamp),
        action: isTyping ? TypingMessage_Action.STARTED : TypingMessage_Action.STOPPED,
        groupId: group?.id,
      },
    },
  }, {
    timestamp, contentHint: ContentHint.Implicit, groupId: group?.id, isOnline: true, isUrgent: false,
  }, group);
}

/** Tells our other devices which messages were read here */
export function sendReadSync(context: SenderContext, reads: { senderAci: string; timestamp: number }[]) {
  return syncToOtherDevices(context, {
    read: reads.map(({ senderAci, timestamp }) => ({ senderAci, timestamp: BigInt(timestamp) })),
  }, Date.now());
}

/** Tells our other devices which view-once or voice messages were viewed here */
export function sendViewedSync(context: SenderContext, views: { senderAci: string; timestamp: number }[]) {
  return syncToOtherDevices(context, {
    viewed: views.map(({ senderAci, timestamp }) => ({ senderAci, timestamp: BigInt(timestamp) })),
  }, Date.now());
}

/** Tells our other devices that a view-once message was opened here, so they erase it too */
export function sendViewOnceOpenSync(context: SenderContext, view: { senderAci: string; timestamp: number }) {
  return syncToOtherDevices(context, {
    content: {
      case: 'viewOnceOpen',
      value: { senderAci: view.senderAci, timestamp: BigInt(view.timestamp) },
    },
  }, Date.now());
}

/** Tells our other devices how we answered a message request (Signal Desktop `getMessageRequestResponseSync`) */
export function sendMessageRequestResponseSync(
  context: SenderContext, response: MessageInitShape<typeof SyncMessage_MessageRequestResponseSchema>,
) {
  return syncToOtherDevices(context, {
    content: { case: 'messageRequestResponse', value: response },
  }, Date.now());
}

/** Sends the whole blocked list to our other devices; the primary device replaces its list with it */
export function sendBlockedSync(context: SenderContext, blocked: MessageInitShape<typeof SyncMessage_BlockedSchema>) {
  return syncToOtherDevices(context, { content: { case: 'blocked', value: blocked } }, Date.now());
}

/** Asks our other devices to fetch the latest state of `type`, such as our storage manifest after a write */
export function sendFetchLatestSync(context: SenderContext, type: SyncMessage_FetchLatest_Type) {
  return syncToOtherDevices(context, { content: { case: 'fetchLatest', value: { type } } }, Date.now());
}

/** Tells our other devices which messages and conversations were deleted here (Signal Desktop `getDeleteForMeSyncMessage`) */
export function sendDeleteForMeSync(
  context: SenderContext, deleteForMe: MessageInitShape<typeof SyncMessage_DeleteForMeSchema>,
) {
  return syncToOtherDevices(context, { content: { case: 'deleteForMe', value: deleteForMe } }, Date.now());
}

/** A null message starts a new session after the old one was archived */
export function sendNullMessage(context: SenderContext, destination: string) {
  return sendContent(context, destination, {
    content: { case: 'nullMessage', value: { padding: getRandomPadding() } },
  }, { timestamp: Date.now(), contentHint: ContentHint.Implicit, isUrgent: false });
}

/** Group content goes with sender key to the members that allow it, and one by one to the rest */
async function sendToRecipients(
  context: SenderContext,
  recipients: string[],
  content: MessageInitShape<typeof ContentSchema>,
  options: SendOptions & { contentHint: ContentHint },
  group?: GroupTarget,
): Promise<RecipientResult[]> {
  if (!group) return sendToEach(context, recipients, content, options);

  const { results, remaining } = await sendWithSenderKey(
    context, { type: 'group', group }, recipients, content, options,
  );
  return [...results, ...await sendToEach(context, remaining, content, options)];
}

async function syncToOtherDevices(
  context: SenderContext, init: MessageInitShape<typeof SyncMessageSchema>, timestamp: number,
): Promise<SendResult> {
  // A primary device without linked devices has nobody to sync with (Signal Android
  // `SignalServiceMessageSender.sendSyncMessage`); linked devices become known from their sessions with us
  const { store, account } = context;
  if (account.deviceId === SIGNAL_PRIMARY_DEVICE_ID
    && !(await store.getSessionDeviceIds(account.aci)).some((deviceId) => deviceId !== account.deviceId)) {
    return { isSealedSender: false };
  }

  const syncMessage = create(SyncMessageSchema, init);
  syncMessage.padding = getRandomPadding();
  return sendContent(context, context.account.aci, {
    content: { case: 'syncMessage', value: syncMessage },
  }, { timestamp, contentHint: ContentHint.Resendable });
}
