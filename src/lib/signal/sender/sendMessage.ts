import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type { DataMessageSchema, EditMessageSchema, ReceiptMessage_Type } from '../proto/generated/SignalService_pb';
import type { SenderContext, SendPayload } from './sendContent';

import { getRandomPadding } from '../crypto';
import { ContentHint, sendContent } from './sendContent';

import { ContentSchema, SyncMessageSchema, TypingMessage_Action } from '../proto/generated/SignalService_pb';

export type OutgoingMessage =
  | { case: 'dataMessage'; value: MessageInitShape<typeof DataMessageSchema> }
  | { case: 'editMessage'; value: MessageInitShape<typeof EditMessageSchema> };

export type RecipientResult = {
  serviceId: string;
  isSealedSender?: boolean;
  error?: Error;
};

type MessageOptions = {
  timestamp: number;
  // Group identifier of group messages (`GroupPublicParams_GetGroupIdentifier`)
  groupId?: Uint8Array;
  expirationStartTimestamp?: number;
};

const SENT_PROTO_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SENT_PROTO_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
// Sends to group members run in parallel; encryption itself is serialized by the protocol lock
const SEND_CONCURRENCY = 8;

let lastSentProtoPruneAt = 0;

/**
 * Sends a data or edit message to its recipients one by one (groups fan out to their members), then a sent
 * transcript to our other devices, and keeps the content for a day so recipients can ask for a resend
 * (Signal Desktop `ts/textsecure/SendMessage.preload.ts`). A message to ourselves sends only the transcript.
 */
export async function sendMessage(
  context: SenderContext, recipients: string[], message: OutgoingMessage, options: MessageOptions,
) {
  const { store, account } = context;
  const others = recipients.filter((serviceId) => serviceId !== account.aci);
  const content = { content: message };
  const results = await sendToRecipients(context, others, content, {
    timestamp: options.timestamp, contentHint: ContentHint.Resendable, groupId: options.groupId,
  });

  await store.addSentProto({
    timestamp: options.timestamp,
    content: toBinary(ContentSchema, create(ContentSchema, content)),
    contentHint: ContentHint.Resendable,
    recipients: others,
    groupId: options.groupId,
    isUrgent: true,
    savedAt: Date.now(),
  });

  if (!others.length || results.some(({ error }) => !error)) {
    await syncToOtherDevices(context, {
      content: {
        case: 'sent',
        value: {
          destinationServiceId: !options.groupId ? others[0] : undefined,
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
  context: SenderContext, recipients: string[], isTyping: boolean, groupId?: Uint8Array,
) {
  const timestamp = Date.now();
  return sendToRecipients(context, recipients.filter((serviceId) => serviceId !== context.account.aci), {
    content: {
      case: 'typingMessage',
      value: {
        timestamp: BigInt(timestamp),
        action: isTyping ? TypingMessage_Action.STARTED : TypingMessage_Action.STOPPED,
        groupId,
      },
    },
  }, {
    timestamp, contentHint: ContentHint.Implicit, groupId, isOnline: true, isUrgent: false,
  });
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

/** A null message starts a new session after the old one was archived */
export function sendNullMessage(context: SenderContext, destination: string) {
  return sendContent(context, destination, {
    content: { case: 'nullMessage', value: { padding: getRandomPadding() } },
  }, { timestamp: Date.now(), contentHint: ContentHint.Implicit, isUrgent: false });
}

async function sendToRecipients(
  context: SenderContext,
  recipients: string[],
  payload: SendPayload,
  options: Parameters<typeof sendContent>[3],
): Promise<RecipientResult[]> {
  const results: RecipientResult[] = [];
  let nextIndex = 0;
  async function sendNext() {
    while (nextIndex < recipients.length) {
      const index = nextIndex++;
      const serviceId = recipients[index];
      try {
        const { isSealedSender } = await sendContent(context, serviceId, payload, options);
        results[index] = { serviceId, isSealedSender };
      } catch (err) {
        results[index] = { serviceId, error: err as Error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, recipients.length) }, sendNext));
  return results;
}

function syncToOtherDevices(
  context: SenderContext, init: MessageInitShape<typeof SyncMessageSchema>, timestamp: number,
) {
  const syncMessage = create(SyncMessageSchema, init);
  syncMessage.padding = getRandomPadding();
  return sendContent(context, context.account.aci, {
    content: { case: 'syncMessage', value: syncMessage },
  }, { timestamp, contentHint: ContentHint.Resendable });
}
