import type { ConversationRecord, MessageRecord, SendStatus } from '../db/MessageDb';

export type MessageSendState = 'pending' | 'partial' | 'failed';

type SendStateFields = Pick<MessageRecord, 'recipientStatus' | 'recipientErrors'>;
type SendStateConversation = Pick<ConversationRecord, 'type' | 'memberAcis'>;

const REACHED_STATUSES = new Set<SendStatus>(['sent', 'delivered', 'read', 'viewed']);

/**
 * How an outgoing message shows its send state: failed when no recipient got it, and partial when some did not
 * (Signal Desktop `getMessagePropStatus` in `ts/state/selectors/message.preload.ts`). It is pending while no recipient
 * got it and none failed. Members of a group whose accounts are gone, and people who left the group, are no failures:
 * the message looks sent, and the message details name them (Signal Desktop `send` in
 * `ts/messages/send.preload.ts`). `undefined` means sent.
 */
export function getMessageSendState(
  message: SendStateFields & Pick<MessageRecord, 'isOutgoing'>,
  conversation: SendStateConversation,
): MessageSendState | undefined {
  const { isOutgoing, recipientStatus } = message;
  if (!isOutgoing || !recipientStatus) return undefined;

  const entries = Object.entries(recipientStatus);
  const hasFailure = getFailedRecipients(message, conversation).length > 0;
  const hasReached = entries.some(([, status]) => REACHED_STATUSES.has(status));
  if (hasFailure) return hasReached ? 'partial' : 'failed';
  if (!hasReached && entries.some(([, status]) => status === 'pending')) return 'pending';
  return undefined;
}

/** The recipients that `Resend` tries again: those a failure counts for, see `getMessageSendState` */
export function getFailedRecipients(
  { recipientStatus, recipientErrors }: SendStateFields, conversation: SendStateConversation,
) {
  return Object.entries(recipientStatus ?? {})
    .filter(([aci, status]) => status === 'failed' && !(
      conversation.type === 'group'
      && (recipientErrors?.[aci] === 'unregistered' || conversation.memberAcis?.includes(aci) === false)
    ))
    .map(([aci]) => aci);
}
