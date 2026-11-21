import type { ConversationType, MessageRecord, SendStatus } from '../db/MessageDb';

export type MessageSendState = 'pending' | 'partial' | 'failed';

type SendStateFields = Pick<MessageRecord, 'recipientStatus' | 'recipientErrors'>;

const REACHED_STATUSES = new Set<SendStatus>(['sent', 'delivered', 'read', 'viewed']);

/**
 * How an outgoing message shows its send state: failed when no recipient got it, and partial when some did not
 * (Signal Desktop `getMessagePropStatus` in `ts/state/selectors/message.preload.ts`). It is pending while no recipient
 * got it and none failed. Members of a group whose accounts are gone are no failures: the message looks sent, and the
 * message details name them (Signal Desktop `send` in `ts/messages/send.preload.ts`). `undefined` means sent.
 */
export function getMessageSendState(
  { isOutgoing, recipientStatus, recipientErrors }: SendStateFields & Pick<MessageRecord, 'isOutgoing'>,
  conversationType: ConversationType,
): MessageSendState | undefined {
  if (!isOutgoing || !recipientStatus) return undefined;

  const entries = Object.entries(recipientStatus);
  const hasFailure = entries.some(([aci, status]) => (
    status === 'failed' && !(conversationType === 'group' && recipientErrors?.[aci] === 'unregistered')
  ));
  const hasReached = entries.some(([, status]) => REACHED_STATUSES.has(status));
  if (hasFailure) return hasReached ? 'partial' : 'failed';
  if (!hasReached && entries.some(([, status]) => status === 'pending')) return 'pending';
  return undefined;
}

/** Whether `Resend` has recipients to try: the failed ones, except the members of a group whose accounts are gone */
export function getResendRecipients(
  { recipientStatus, recipientErrors }: SendStateFields,
  conversationType: ConversationType,
) {
  return Object.entries(recipientStatus ?? {})
    .filter(([aci, status]) => status === 'failed' && !(
      conversationType === 'group' && recipientErrors?.[aci] === 'unregistered'
    ))
    .map(([aci]) => aci);
}
