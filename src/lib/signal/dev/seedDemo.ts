import type { MessageInitShape } from '@bufbuild/protobuf';
import { create, toBinary } from '@bufbuild/protobuf';

import type MessageDb from '../db/MessageDb';
import type { ConversationRecord, NewMessageRecord } from '../db/MessageDb';
import type SignalStore from '../store/SignalStore';

import { bufferFromHex } from '../../../util/encoding/buffer';
import { saveAttachmentBlob } from '../attachments/attachmentCache';
import { getRandomBytes } from '../crypto';
import { fetchStickerImage, getKnownStickerPacks } from '../stickers/stickerPacks';
import { wasm } from '../wasm';

import {
  AttachmentPointerSchema,
  BodyRange_Style,
  DataMessage_Contact_Phone_Type,
  DataMessageSchema,
  Verified_State,
} from '../proto/generated/SignalService_pb';

const MINUTE = 60 * 1000;
const PHOTO_WIDTH = 1280;
const PHOTO_HEIGHT = 960;
const PHOTO_MIME_TYPE = 'image/jpeg';
const TRAIL_WIDTH = 24;
// Trail points as fractions of the photo size
const TRAIL_POINTS = [[0.1, 0.85], [0.35, 0.45], [0.6, 0.7], [0.9, 0.15]];
const SUN_RADIUS = 120;
const SUN_CENTER_Y = 0.7 * PHOTO_HEIGHT;
const LAKE_TOP = 0.55 * PHOTO_HEIGHT;
// Zozo the French Bulldog, from Signal's artist series
const DEMO_STICKER_PACK_INDEX = 2;
const DEMO_STICKER_ID = 0;

type DemoMessage = Omit<NewMessageRecord, 'conversationId' | 'receivedAt' | 'body' | 'dataMessage' | 'kind'> & {
  kind?: NewMessageRecord['kind'];
  dataMessage?: MessageInitShape<typeof DataMessageSchema>;
};

/**
 * Fills the stores with a fake account, contacts, a group and messages, so the UI can be checked without
 * a phone. The account has `isDemo`, so the client never connects, and attachments are either cached
 * locally or marked unavailable, so they are never downloaded; reload the page afterwards.
 */
export async function seedDemo(store: SignalStore, db: MessageDb) {
  await store.clear();
  await db.clear();

  const trailPhoto = await createDemoPhoto('demo-photo', drawTrailMap);
  const viewOncePhoto = await createDemoPhoto('demo-view-once-photo', drawSunset);
  const albumPhotos = [
    await createDemoPhoto('demo-album-trail', drawTrailMap),
    await createDemoPhoto('demo-album-sunset', drawSunset),
    await createDemoPhoto('demo-album-lake', drawLake),
  ];
  const previewPhoto = await createDemoPhoto('demo-preview', drawLake);
  const sticker = await createDemoSticker();

  const me = crypto.randomUUID();
  const alice = crypto.randomUUID();
  const bob = crypto.randomUUID();
  const carol = crypto.randomUUID();
  const dave = crypto.randomUUID();
  const eve = crypto.randomUUID();
  const frank = crypto.randomUUID();
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
    usernameLink: { entropy: getRandomBytes(32), serverId: crypto.randomUUID() },
    isDemo: true,
  });
  // Identity keys give safety numbers; Alice's is verified
  await store.setItem('aciIdentityKeyPair', generateKeyPair());
  await store.setIdentity(alice, { publicKey: generateKeyPair().publicKey, verified: Verified_State.VERIFIED });
  await store.setIdentity(bob, { publicKey: generateKeyPair().publicKey });

  const conversations: ConversationRecord[] = [
    {
      id: me,
      localId: 1,
      type: 'private',
      profileName: 'Demo',
      profileFamilyName: 'User',
      username: 'demo.01',
      about: 'Testing TeleSignal',
      aboutEmoji: '🧪',
      unreadCount: 0,
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
    // A message request from a group whose members we do not know
    {
      id: btoa(String.fromCharCode(...getRandomBytes(32))),
      localId: 7,
      type: 'group',
      masterKey: getRandomBytes(32),
      revision: 1,
      title: 'Crypto giveaway',
      memberAcis: [me, frank],
      adminAcis: [frank],
      unreadCount: 1,
    },
    {
      id: frank, localId: 8, type: 'private', profileName: 'Frank', unreadCount: 0,
    },
    {
      id: eve, localId: 9, type: 'private', profileName: 'Eve', e164: '+15550100009', unreadCount: 0, isBlocked: true,
    },
  ];
  const [, aliceChat, bobChat, carolChat, daveChat, group, requestGroup, , eveChat] = conversations;

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
      kind: 'verifiedChange', authorAci: '', actorAci: alice, sentAt: now - 65 * MINUTE, isOutgoing: false, readAt: now,
      isVerified: true,
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
        attachments: [trailPhoto],
      },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 45 * MINUTE,
      isOutgoing: false,
      readAt: now - 44 * MINUTE,
      dataMessage: { isViewOnce: true, attachments: [viewOncePhoto] },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 40 * MINUTE,
      isOutgoing: false,
      readAt: now - 39 * MINUTE,
      dataMessage: { body: 'Photos from our last trip', attachments: albumPhotos },
    }],
    [aliceChat, {
      authorAci: alice,
      sentAt: now - 38 * MINUTE,
      isOutgoing: false,
      readAt: now - 37 * MINUTE,
      ...sticker,
    }],
    [bobChat, {
      authorAci: me, sentAt: now - 300 * MINUTE, isOutgoing: true, readAt: now, recipientStatus: { [bob]: 'sent' },
      dataMessage: { body: 'Found you by username 👋' },
    }],
    [bobChat, {
      kind: 'safetyNumberChange',
      authorAci: '',
      actorAci: bob,
      sentAt: now - 295 * MINUTE,
      isOutgoing: false,
      readAt: now,
    }],
    [bobChat, {
      authorAci: bob,
      sentAt: now - 295 * MINUTE,
      isOutgoing: false,
      readAt: now,
      dataMessage: {
        contact: [{
          name: { givenName: 'Alice', familyName: 'Johnson' },
          number: [{ value: '+15550100001', type: DataMessage_Contact_Phone_Type.MOBILE }],
        }],
      },
    }],
    [bobChat, {
      authorAci: bob,
      sentAt: now - 294 * MINUTE,
      isOutgoing: false,
      readAt: now,
      dataMessage: {
        contact: [{
          name: { givenName: 'Grace', familyName: 'Hopper' },
          number: [{ value: '+15550109999', type: DataMessage_Contact_Phone_Type.HOME }],
          email: [{ value: 'grace@example.com' }],
          organization: 'Navy',
        }],
      },
    }],
    [bobChat, {
      authorAci: bob,
      sentAt: now - 290 * MINUTE,
      isOutgoing: false,
      readAt: now,
      unavailableAttachmentIndexes: [0],
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
      authorAci: carol,
      sentAt: now - 19 * MINUTE,
      isOutgoing: false,
      dataMessage: {
        body: 'Trail guide: https://example.com/trails/lake',
        preview: [{
          url: 'https://example.com/trails/lake',
          title: 'Lake loop trail',
          description: 'A 6 km loop around the lake with a picnic area halfway',
          image: previewPhoto,
          date: BigInt(now - 3 * 24 * 60 * MINUTE),
        }],
      },
    }],
    [carolChat, {
      authorAci: carol, sentAt: now - 18 * MINUTE, isOutgoing: false, dataMessage: { body: 'Call me when you can' },
    }],
    [daveChat, {
      authorAci: dave,
      sentAt: now - 10 * MINUTE,
      isOutgoing: false,
      dataMessage: { body: 'Hi, we met at the conference' },
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'create' },
      sentAt: now - 50 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'membersAdded', acis: [me, bob] },
      sentAt: now - 49 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'inviteLink', state: 'onWithApproval' },
      sentAt: now - 48 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: carol, groupUpdate: { type: 'joinRequested' },
      sentAt: now - 47 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'joinApproved', aci: carol },
      sentAt: now - 46 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: me, groupUpdate: { type: 'description' },
      sentAt: now - 45 * MINUTE, isOutgoing: true, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate',
      authorAci: '',
      actorAci: alice,
      groupUpdate: { type: 'adminChanged', aci: bob, isAdmin: true },
      sentAt: now - 44 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate',
      authorAci: '',
      actorAci: alice,
      groupUpdate: { type: 'access', target: 'info', isAdminOnly: true },
      sentAt: now - 43 * MINUTE, isOutgoing: false, readAt: now,
    }],
    [group, {
      kind: 'groupUpdate', authorAci: '', actorAci: alice, groupUpdate: { type: 'invited', count: 2 },
      sentAt: now - 42 * MINUTE, isOutgoing: false, readAt: now,
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
      authorAci: bob,
      sentAt: now - 33 * MINUTE,
      isOutgoing: false,
      readAt: now,
      deletedAt: now - 32 * MINUTE,
      deletedByAdminAci: alice,
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
    [requestGroup, {
      authorAci: frank, sentAt: now - 3 * MINUTE, isOutgoing: false,
      dataMessage: { body: 'Double your coins today, limited offer!' },
    }],
    [eveChat, {
      authorAci: eve, sentAt: now - 600 * MINUTE, isOutgoing: false, readAt: now,
      dataMessage: { body: 'You won a prize' },
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

/**
 * A sticker of Signal's artist series. Its image is downloaded from the sticker CDN now and cached as the attachment,
 * so the message shows it without a connection; without the CDN it shows as unavailable.
 */
async function createDemoSticker(): Promise<Pick<DemoMessage, 'dataMessage' | 'isStickerUnavailable'>> {
  const { id, key } = getKnownStickerPacks()[DEMO_STICKER_PACK_INDEX];
  const blob = await fetchStickerImage(id, key, DEMO_STICKER_ID).catch(() => undefined);
  const data = create(AttachmentPointerSchema, {
    attachmentIdentifier: { case: 'cdnKey', value: 'demo-sticker' },
    cdnNumber: 3,
    contentType: blob?.type || 'image/webp',
    key: getRandomBytes(64),
    size: blob?.size ?? 0,
  });
  if (blob) await saveAttachmentBlob(data, blob);
  return {
    isStickerUnavailable: blob ? undefined : true,
    dataMessage: {
      sticker: {
        packId: bufferFromHex(id), packKey: bufferFromHex(key), stickerId: DEMO_STICKER_ID, emoji: '✨', data,
      },
    },
  };
}

/** A photo attachment whose bytes are cached, so it shows without a download */
async function createDemoPhoto(cdnKey: string, draw: (context: OffscreenCanvasRenderingContext2D) => void) {
  const canvas = new OffscreenCanvas(PHOTO_WIDTH, PHOTO_HEIGHT);
  draw(canvas.getContext('2d')!);
  const blob = await canvas.convertToBlob({ type: PHOTO_MIME_TYPE });
  const pointer = create(AttachmentPointerSchema, {
    attachmentIdentifier: { case: 'cdnKey', value: cdnKey },
    cdnNumber: 3,
    contentType: PHOTO_MIME_TYPE,
    key: getRandomBytes(64),
    size: blob.size,
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
  });
  await saveAttachmentBlob(pointer, blob);
  return pointer;
}

function drawTrailMap(context: OffscreenCanvasRenderingContext2D) {
  const gradient = context.createLinearGradient(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
  gradient.addColorStop(0, '#a8d5a2');
  gradient.addColorStop(1, '#4f8f5b');
  context.fillStyle = gradient;
  context.fillRect(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);

  context.strokeStyle = '#c0392b';
  context.lineWidth = TRAIL_WIDTH;
  context.lineCap = 'round';
  context.beginPath();
  TRAIL_POINTS.forEach(([x, y]) => context.lineTo(x * PHOTO_WIDTH, y * PHOTO_HEIGHT));
  context.stroke();
}

function drawLake(context: OffscreenCanvasRenderingContext2D) {
  context.fillStyle = '#9fd3f0';
  context.fillRect(0, 0, PHOTO_WIDTH, LAKE_TOP);
  context.fillStyle = '#2e7fb8';
  context.fillRect(0, LAKE_TOP, PHOTO_WIDTH, PHOTO_HEIGHT - LAKE_TOP);
}

function drawSunset(context: OffscreenCanvasRenderingContext2D) {
  const gradient = context.createLinearGradient(0, 0, 0, PHOTO_HEIGHT);
  gradient.addColorStop(0, '#2c3e70');
  gradient.addColorStop(1, '#f39c4a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);

  context.fillStyle = '#ffd56b';
  context.beginPath();
  context.arc(PHOTO_WIDTH / 2, SUN_CENTER_Y, SUN_RADIUS, 0, 2 * Math.PI);
  context.fill();
}

function generateKeyPair() {
  const privateKey = wasm.PrivateKey_Generate();
  return {
    privateKey: wasm.PrivateKey_Serialize(privateKey),
    publicKey: wasm.PublicKey_Serialize(wasm.PrivateKey_GetPublicKey(privateKey)),
  };
}
