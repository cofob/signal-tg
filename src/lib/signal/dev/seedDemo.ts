import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type MessageDb from '../db/MessageDb';
import type { ConversationRecord, NewMessageRecord } from '../db/MessageDb';
import type SignalStore from '../store/SignalStore';

import { getRandomBytes } from '../crypto';

import { BodyRange_Style, DataMessageSchema } from '../proto/generated/SignalService_pb';

const MINUTE = 60 * 1000;
const PHOTO_WIDTH = 1280;
const PHOTO_HEIGHT = 960;

type DemoMessage = Omit<NewMessageRecord, 'conversationId' | 'receivedAt' | 'body' | 'dataMessage' | 'kind'> & {
  kind?: NewMessageRecord['kind'];
  dataMessage?: MessageInitShape<typeof DataMessageSchema>;
};

/**
 * Fills the stores with a fake account, contacts, a group and messages, so the UI can be checked without
 * a phone. The account has `isDemo`, so the client never connects; reload the page afterwards.
 */
export async function seedDemo(store: SignalStore, db: MessageDb) {
  await store.clear();
  await db.clear();

  const me = crypto.randomUUID();
  const alice = crypto.randomUUID();
  const bob = crypto.randomUUID();
  const carol = crypto.randomUUID();
  const dave = crypto.randomUUID();
  const now = Date.now();

  await store.setItem('account', {
    aci: me,
    deviceId: 2,
    deviceName: 'TeleSignal (demo)',
    password: 'demo',
    registrationId: 1,
    pniRegistrationId: 1,
    profileKey: getRandomBytes(32),
    isReadReceiptsEnabled: true,
    isDemo: true,
  });

  const conversations: ConversationRecord[] = [
    {
      id: me, localId: 1, type: 'private', profileName: 'Demo', profileFamilyName: 'User', unreadCount: 0,
    },
    {
      id: alice,
      localId: 2,
      type: 'private',
      profileName: 'Alice',
      profileFamilyName: 'Johnson',
      systemName: 'Alice Johnson',
      e164: '+15550100001',
      about: 'Coffee first',
      unreadCount: 0,
      isAccepted: true,
      pinIndex: 0,
    },
    {
      id: bob, localId: 3, type: 'private', profileName: 'Bob', username: 'bob.42', unreadCount: 0, isAccepted: true,
    },
    {
      id: carol,
      localId: 4,
      type: 'private',
      profileName: 'Carol',
      profileFamilyName: 'Diaz',
      unreadCount: 2,
      isAccepted: true,
      mutedUntil: now + 24 * 60 * MINUTE,
    },
    {
      id: dave, localId: 5, type: 'private', profileName: 'Dave', unreadCount: 1,
    },
    {
      id: btoa(String.fromCharCode(...getRandomBytes(32))),
      localId: 6,
      type: 'group',
      masterKey: getRandomBytes(32),
      revision: 3,
      title: 'Weekend trip',
      description: 'Saturday hike and picnic',
      memberAcis: [me, alice, bob, carol],
      adminAcis: [alice],
      unreadCount: 1,
      isAccepted: true,
    },
  ];
  const [, aliceChat, bobChat, carolChat, daveChat, group] = conversations;

  const messages: [ConversationRecord, DemoMessage][] = [
    [aliceChat, {
      authorAci: alice, sentAt: now - 90 * MINUTE, isOutgoing: false, readAt: now - 80 * MINUTE,
      dataMessage: { body: 'Hi! Are we still on for Saturday?' },
    }],
    [aliceChat, {
      authorAci: me,
      sentAt: now - 85 * MINUTE,
      isOutgoing: true,
      readAt: now - 85 * MINUTE,
      recipientStatus: { [alice]: 'read' },
      reactions: [{ emoji: '❤️', authorAci: alice, sentAt: now - 84 * MINUTE }],
      dataMessage: {
        body: 'Yes! 10am at the station',
        bodyRanges: [{ start: 5, length: 4, associatedValue: { case: 'style', value: BodyRange_Style.BOLD } }],
      },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 80 * MINUTE,
      isOutgoing: false,
      readAt: now - 70 * MINUTE,
      dataMessage: {
        body: 'Perfect, I will bring snacks',
        quote: { id: BigInt(now - 85 * MINUTE), authorAci: me, text: 'Yes! 10am at the station' },
      },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 75 * MINUTE,
      isOutgoing: false,
      readAt: now - 70 * MINUTE,
      editedAt: now - 74 * MINUTE,
      revisions: [{
        dataMessage: toBinary(DataMessageSchema, create(DataMessageSchema, { body: 'Bring a jaket' })),
        editedAt: now - 75 * MINUTE,
      }],
      dataMessage: { body: 'Bring a jacket, it may rain' },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 73 * MINUTE,
      isOutgoing: false,
      readAt: now - 70 * MINUTE,
      deletedAt: now - 72 * MINUTE,
    }],
    [aliceChat, {
      kind: 'timerUpdate', authorAci: '', actorAci: me, sentAt: now - 60 * MINUTE, isOutgoing: true, readAt: now,
      expireTimer: 7 * 24 * 60 * 60,
    }],
    [aliceChat, {
      authorAci: me,
      sentAt: now - 50 * MINUTE,
      isOutgoing: true,
      readAt: now - 50 * MINUTE,
      recipientStatus: { [alice]: 'delivered' },
      expireTimer: 7 * 24 * 60 * 60,
      expiresAt: now + 7 * 24 * 60 * MINUTE,
      dataMessage: {
        body: 'Map of the trail',
        expireTimer: 7 * 24 * 60 * 60,
        attachments: [{
          attachmentIdentifier: { case: 'cdnKey', value: 'demo-photo' },
          cdnNumber: 3,
          contentType: 'image/jpeg',
          key: getRandomBytes(64),
          size: 245_000,
          width: PHOTO_WIDTH,
          height: PHOTO_HEIGHT,
          blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        }],
      },
    }],
    [bobChat, {
      authorAci: me, sentAt: now - 300 * MINUTE, isOutgoing: true, readAt: now, recipientStatus: { [bob]: 'sent' },
      dataMessage: { body: 'Found you by username 👋' },
    }],
    [bobChat, {
      authorAci: bob, sentAt: now - 290 * MINUTE, isOutgoing: false, readAt: now,
      dataMessage: { body: 'Hey! Sending the report', attachments: [{
        attachmentIdentifier: { case: 'cdnKey', value: 'demo-file' },
        cdnNumber: 3,
        contentType: 'application/pdf',
        key: getRandomBytes(64),
        size: 1_200_000,
        fileName: 'report.pdf',
      }] },
    }],
    [carolChat, {
      authorAci: carol, sentAt: now - 20 * MINUTE, isOutgoing: false, dataMessage: { body: 'Did you see the photos?' },
    }],
    [carolChat, {
      authorAci: carol, sentAt: now - 19 * MINUTE, isOutgoing: false, dataMessage: { body: 'Call me when you can' },
    }],
    [daveChat, {
      authorAci: dave,
      sentAt: now - 10 * MINUTE,
      isOutgoing: false,
      dataMessage: { body: 'Hi, we met at the conference' },
    }],
    [group, {
      authorAci: alice, sentAt: now - 40 * MINUTE, isOutgoing: false, readAt: now,
      dataMessage: { body: 'Plan for Saturday: hike, then picnic by the lake' },
    }],
    [group, {
      authorAci: bob, sentAt: now - 35 * MINUTE, isOutgoing: false, readAt: now,
      reactions: [{ emoji: '👍', authorAci: alice, sentAt: now - 34 * MINUTE }],
      dataMessage: {
        body: '@Demo can you book the tables?',
        bodyRanges: [{ start: 0, length: 5, associatedValue: { case: 'mentionAci', value: me } }],
      },
    }],
    [group, {
      authorAci: me, sentAt: now - 30 * MINUTE, isOutgoing: true, readAt: now,
      recipientStatus: { [alice]: 'read', [bob]: 'delivered', [carol]: 'sent' },
      dataMessage: { body: 'Booked for 2pm' },
    }],
    [group, {
      authorAci: alice,
      sentAt: now - 25 * MINUTE,
      isOutgoing: false,
      readAt: now,
      pollVotes: [
        { authorAci: alice, optionIndexes: [0], voteCount: 1 },
        { authorAci: bob, optionIndexes: [1], voteCount: 1 },
        { authorAci: me, optionIndexes: [0], voteCount: 1 },
      ],
      dataMessage: { pollCreate: { question: 'What should we bring?', options: ['Sandwiches', 'Pizza', 'Fruit'] } },
    }],
    [group, {
      authorAci: carol, sentAt: now - 5 * MINUTE, isOutgoing: false, dataMessage: { body: 'Count me in!' },
    }],
  ];

  const lastByConversation = new Map<string, { id: number; sentAt: number }>();
  for (const [conversation, { dataMessage, kind = 'message', ...record }] of messages) {
    const message = await db.addMessage({
      ...record,
      conversationId: conversation.id,
      kind,
      receivedAt: record.sentAt,
      body: dataMessage?.body || undefined,
      dataMessage: dataMessage && !record.deletedAt
        ? toBinary(DataMessageSchema, create(DataMessageSchema, { ...dataMessage, timestamp: BigInt(record.sentAt) }))
        : undefined,
    });
    lastByConversation.set(conversation.id, { id: message.id, sentAt: message.sentAt });
  }

  for (const conversation of conversations) {
    const last = lastByConversation.get(conversation.id);
    await db.putConversation({ ...conversation, lastMessageId: last?.id, lastMessageAt: last?.sentAt });
  }
}
