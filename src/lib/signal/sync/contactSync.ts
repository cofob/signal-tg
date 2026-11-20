import { uuidToString } from '../serviceId';

import { ContactDetails } from '../proto/generated/SignalService';

export type SyncedContact = {
  aci?: string;
  number?: string;
  name?: string;
  avatar?: { contentType?: string; data: Uint8Array };
  expireTimer?: number;
  expireTimerVersion?: number;
  inboxPosition?: number;
};

const VARINT_CONTINUATION = 0x80;
const VARINT_PAYLOAD = 0x7f;
const VARINT_SHIFT = 7;
const MAX_VARINT_SHIFT = 28;

/**
 * Parses the decrypted contacts blob of `SyncMessage.contacts`: varint-length-prefixed `ContactDetails`,
 * each followed by its avatar bytes when `avatar.length` is set (Signal Desktop `ContactsParser`).
 */
export function parseContactSync(data: Uint8Array): SyncedContact[] {
  const contacts: SyncedContact[] = [];
  let offset = 0;

  while (offset < data.length) {
    let length = 0;
    let shift = 0;
    for (;;) {
      if (offset >= data.length || shift > MAX_VARINT_SHIFT) throw new Error('Invalid contacts blob');
      const byte = data[offset++];
      length |= (byte & VARINT_PAYLOAD) << shift;
      if (!(byte & VARINT_CONTINUATION)) break;
      shift += VARINT_SHIFT;
    }
    if (offset + length > data.length) throw new Error('Truncated contacts blob');

    const details = ContactDetails.decode(data.subarray(offset, offset + length));
    offset += length;

    let avatar: SyncedContact['avatar'];
    const avatarLength = details.avatar?.length ?? 0;
    if (avatarLength) {
      avatar = { contentType: details.avatar?.contentType, data: data.slice(offset, offset + avatarLength) };
      offset += avatarLength;
    }

    contacts.push({
      aci: details.aciBinary?.length ? uuidToString(details.aciBinary) : details.aci,
      number: details.number,
      name: details.name,
      avatar,
      expireTimer: details.expireTimer,
      expireTimerVersion: details.expireTimerVersion,
      inboxPosition: details.inboxPosition,
    });
  }

  return contacts;
}
