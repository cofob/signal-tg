import type { GroupState } from '../groups/fetchGroup';
import type { GroupUpdate } from '../groups/groupUpdates';

export type ConversationType = 'private' | 'group';

export type ConversationRecord = {
  // The ACI of a private conversation, or the base64 group identifier of a group
  id: string;
  // A positive number for the app's peer ids, assigned in creation order
  localId: number;
  type: ConversationType;
  // Private conversations
  e164?: string;
  profileName?: string;
  profileFamilyName?: string;
  systemName?: string;
  nickname?: string;
  about?: string;
  aboutEmoji?: string;
  avatarPath?: string;
  // When the profile was last fetched, by the device clock
  profileFetchedAt?: number;
  username?: string;
  // Groups
  masterKey?: Uint8Array;
  revision?: number;
  title?: string;
  description?: string;
  memberAcis?: string[];
  adminAcis?: string[];
  isAnnouncementsOnly?: boolean;
  // The decrypted state at `revision`; the fields above are read from it
  groupState?: GroupState;
  // Both
  expireTimer?: number;
  expireTimerVersion?: number;
  lastMessageId?: number;
  lastMessageAt?: number;
  unreadCount: number;
  isArchived?: boolean;
  isMarkedUnread?: boolean;
  isBlocked?: boolean;
  // Whether we accepted the message request, wrote first, or share our profile (`whitelisted` in storage)
  isAccepted?: boolean;
  // We reported the conversation as spam
  isReported?: boolean;
  // Stories of the contact or group show in the hidden list (`hideStory` in storage)
  isStoryHidden?: boolean;
  // The last `reportSpamToken` of an envelope from the contact, sent with spam reports
  reportingToken?: Uint8Array;
  mutedUntil?: number;
  // Position in the pinned conversations list
  pinIndex?: number;
  pinnedMessages?: { messageId: number; pinnedAt: number; expiresAt?: number }[];
};

// Safety number notices name the contact in `actorAci`
export type MessageKind = 'message' | 'timerUpdate' | 'groupUpdate' | 'safetyNumberChange' | 'verifiedChange';

export type SendStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'viewed' | 'failed';

// Why a send to a recipient failed. `identityChanged` is the new safety number of a verified contact, which the
// user has to accept; `unregistered` is an account that no longer exists.
export type SendErrorKind = 'unregistered' | 'identityChanged' | 'network' | 'rateLimited' | 'other';

export type MessageRecord = {
  id: number;
  conversationId: string;
  kind: MessageKind;
  // Empty for notices, so that they never match a lookup by author and timestamp; see `actorAci`
  authorAci: string;
  // Who caused a notice, such as a timer change
  actorAci?: string;
  // What a `groupUpdate` notice says
  groupUpdate?: GroupUpdate;
  authorDeviceId?: number;
  // The Signal timestamp: with `authorAci` it identifies the message across devices
  sentAt: number;
  receivedAt: number;
  serverTimestamp?: number;
  isOutgoing: boolean;
  // Serialized `DataMessage`; absent after a remote delete
  dataMessage?: Uint8Array;
  // Earlier versions of an edited message, oldest first
  revisions?: { dataMessage: Uint8Array; editedAt: number }[];
  editedAt?: number;
  deletedAt?: number;
  // The group admin who deleted another member's message for everyone
  deletedByAdminAci?: string;
  // Text of the latest version, for previews and search
  body?: string;
  reactions?: { emoji: string; authorAci: string; sentAt: number }[];
  pollVotes?: { authorAci: string; optionIndexes: number[]; voteCount: number }[];
  isPollEnded?: boolean;
  expireTimer?: number;
  expiresAt?: number;
  readAt?: number;
  viewedAt?: number;
  isViewOnceOpened?: boolean;
  // Indexes in `DataMessage.attachments` that the CDN no longer has
  unavailableAttachmentIndexes?: number[];
  isStickerUnavailable?: true;
  // Delivery state per recipient of an outgoing message
  recipientStatus?: Record<string, SendStatus>;
  // The reason for each recipient whose status is `failed`; messages stored earlier have none
  recipientErrors?: Record<string, SendErrorKind>;
  isSealedSender?: boolean;
  // The server's id of the envelope, which spam reports name
  serverGuid?: string;
  // Verification notices: whether the safety number became verified, and whether another of our devices did it
  isVerified?: boolean;
  isFromOtherDevice?: boolean;
};

export type NewMessageRecord = Omit<MessageRecord, 'id'>;

/** A reply or reaction to a story; group story replies are kept only here, as in Signal Desktop */
export type StoryReply = {
  authorAci: string;
  sentAt: number;
  body?: string;
  emoji?: string;
};

/** Who an outgoing story went to, whether they may reply, and when they viewed it */
export type StoryRecipient = {
  status: SendStatus;
  isAllowedToReply: boolean;
  // Distribution lists that include the recipient; empty for group stories
  distributionListIds: string[];
  viewedAt?: number;
};

export type StoryRecord = {
  id: number;
  // The author's private conversation, the group of a group story, or our ACI for our distribution list stories
  conversationId: string;
  authorAci: string;
  authorDeviceId?: number;
  // The Signal timestamp: with `authorAci` it identifies the story
  sentAt: number;
  receivedAt: number;
  serverTimestamp?: number;
  expiresAt: number;
  isOutgoing: boolean;
  // Serialized `StoryMessage`
  storyMessage: Uint8Array;
  viewedAt?: number;
  // Outgoing stories
  recipients?: Record<string, StoryRecipient>;
  replies?: StoryReply[];
};

export type NewStoryRecord = Omit<StoryRecord, 'id'>;

const DB_NAME = 'ts-signal-messages';
const DB_VERSION = 3;
const CONVERSATIONS = 'conversations';
const MESSAGES = 'messages';
const STORIES = 'stories';
const BY_CONVERSATION = 'byConversation';
const BY_AUTHOR_SENT_AT = 'byAuthorSentAt';
const BY_EXPIRES_AT = 'byExpiresAt';
const BY_LOCAL_ID = 'byLocalId';

/**
 * Conversations, messages and stories of the linked device in IndexedDB. Message ids grow in arrival order,
 * which is the order Signal Desktop shows messages in.
 */
export default class MessageDb {
  private db?: Promise<IDBDatabase>;

  getConversation(id: string) {
    return this.request<ConversationRecord | undefined>(CONVERSATIONS, 'readonly', (store) => store.get(id));
  }

  getConversationByLocalId(localId: number) {
    return this.request<ConversationRecord | undefined>(
      CONVERSATIONS, 'readonly', (store) => store.index(BY_LOCAL_ID).get(localId),
    );
  }

  /** The next free `localId` */
  async allocateLocalId() {
    let maxLocalId = 0;
    const openCursor = (store: IDBObjectStore) => store.index(BY_LOCAL_ID).openKeyCursor(undefined, 'prev');
    await this.iterate(CONVERSATIONS, 'readonly', openCursor, (cursor) => {
      maxLocalId = cursor.key as number;
      return false;
    });
    return maxLocalId + 1;
  }

  getConversations() {
    return this.request<ConversationRecord[]>(CONVERSATIONS, 'readonly', (store) => store.getAll());
  }

  async putConversation(record: ConversationRecord) {
    await this.request(CONVERSATIONS, 'readwrite', (store) => store.put(record));
    return record;
  }

  /** Puts conversations in one transaction */
  async putConversations(records: ConversationRecord[]) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CONVERSATIONS, 'readwrite');
      const store = transaction.objectStore(CONVERSATIONS);
      for (const record of records) store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  getMessage(id: number) {
    return this.request<MessageRecord | undefined>(MESSAGES, 'readonly', (store) => store.get(id));
  }

  async addMessage(record: NewMessageRecord): Promise<MessageRecord> {
    const id = await this.request<IDBValidKey>(MESSAGES, 'readwrite', (store) => store.add(record));
    return { ...record, id: id as number };
  }

  /**
   * Adds messages in order in one transaction, skipping each message whose author and timestamp a stored message
   * has; notices have no author and are always added. Returns the added records, `undefined` for skipped ones.
   */
  async addMessagesIfAbsent(records: NewMessageRecord[]) {
    const db = await this.open();
    return new Promise<(MessageRecord | undefined)[]>((resolve, reject) => {
      const transaction = db.transaction(MESSAGES, 'readwrite');
      const store = transaction.objectStore(MESSAGES);
      const results: (MessageRecord | undefined)[] = [];

      // Each step starts in the callback of the previous one, so a duplicate within `records` is found too
      function addNext() {
        const record = records[results.length];
        if (!record) return;
        const add = () => {
          const request = store.add(record);
          request.onsuccess = () => {
            results.push({ ...record, id: request.result as number });
            addNext();
          };
        };
        if (!record.authorAci) {
          add();
          return;
        }
        const lookup = store.index(BY_AUTHOR_SENT_AT).getKey([record.authorAci, record.sentAt]);
        lookup.onsuccess = () => {
          if (lookup.result === undefined) {
            add();
            return;
          }
          results.push(undefined);
          addNext();
        };
      }

      transaction.oncomplete = () => resolve(results);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      addNext();
    });
  }

  async putMessage(record: MessageRecord) {
    await this.request(MESSAGES, 'readwrite', (store) => store.put(record));
    return record;
  }

  deleteMessage(id: number) {
    return this.request(MESSAGES, 'readwrite', (store) => store.delete(id));
  }

  /** Deletes the messages of a conversation up to `maxId` (every message by default) and returns their ids */
  async deleteConversationMessages(conversationId: string, maxId = Number.MAX_SAFE_INTEGER) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, maxId]);
    const ids: number[] = [];
    await this.iterate(MESSAGES, 'readwrite', (store) => store.index(BY_CONVERSATION).openCursor(range), (cursor) => {
      ids.push((cursor.value as MessageRecord).id);
      cursor.delete();
      return true;
    });
    return ids;
  }

  /** Finds a message by its author and Signal timestamp */
  findMessage(authorAci: string, sentAt: number) {
    return this.request<MessageRecord | undefined>(
      MESSAGES, 'readonly', (store) => store.index(BY_AUTHOR_SENT_AT).get([authorAci, sentAt]),
    );
  }

  /** Messages of a conversation, newest first, older than `beforeId` when it is set */
  async getMessages(conversationId: string, limit: number, beforeId = Number.MAX_SAFE_INTEGER) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, beforeId], false, true);
    const messages: MessageRecord[] = [];
    const openCursor = (store: IDBObjectStore) => store.index(BY_CONVERSATION).openCursor(range, 'prev');
    await this.iterate(MESSAGES, 'readonly', openCursor, (cursor) => {
      messages.push(cursor.value as MessageRecord);
      return messages.length < limit;
    });
    return messages;
  }

  /** The newest messages of a conversation that pass `filter`, newest first */
  async findLatestMessages(conversationId: string, limit: number, filter: (message: MessageRecord) => boolean) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER]);
    const messages: MessageRecord[] = [];
    const openCursor = (store: IDBObjectStore) => store.index(BY_CONVERSATION).openCursor(range, 'prev');
    await this.iterate(MESSAGES, 'readonly', openCursor, (cursor) => {
      const message = cursor.value as MessageRecord;
      if (filter(message)) messages.push(message);
      return messages.length < limit;
    });
    return messages;
  }

  /** Messages of a conversation, oldest first, starting at `fromId` */
  async getMessagesFrom(conversationId: string, limit: number, fromId: number) {
    const range = IDBKeyRange.bound([conversationId, fromId], [conversationId, Number.MAX_SAFE_INTEGER]);
    const messages: MessageRecord[] = [];
    const openCursor = (store: IDBObjectStore) => store.index(BY_CONVERSATION).openCursor(range);
    await this.iterate(MESSAGES, 'readonly', openCursor, (cursor) => {
      messages.push(cursor.value as MessageRecord);
      return messages.length < limit;
    });
    return messages;
  }

  countMessages(conversationId: string) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER]);
    return this.request<number>(MESSAGES, 'readonly', (store) => store.index(BY_CONVERSATION).count(range));
  }

  /** Incoming messages of a conversation not read yet, up to `maxId` */
  async getUnreadMessages(conversationId: string, maxId = Number.MAX_SAFE_INTEGER) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, maxId]);
    const messages: MessageRecord[] = [];
    await this.iterate(MESSAGES, 'readonly', (store) => store.index(BY_CONVERSATION).openCursor(range), (cursor) => {
      const message = cursor.value as MessageRecord;
      if (!message.isOutgoing && !message.readAt && message.kind === 'message') messages.push(message);
      return true;
    });
    return messages;
  }

  /** Messages whose disappearing timer ran out by `time` */
  getExpiredMessages(time: number) {
    return this.request<MessageRecord[]>(
      MESSAGES, 'readonly', (store) => store.index(BY_EXPIRES_AT).getAll(IDBKeyRange.upperBound(time)),
    );
  }

  /** The earliest time a disappearing message expires */
  async getNextExpiresAt() {
    const message = await this.request<MessageRecord | undefined>(
      MESSAGES, 'readonly', (store) => store.index(BY_EXPIRES_AT).get(IDBKeyRange.lowerBound(0)),
    );
    return message?.expiresAt;
  }

  getStory(id: number) {
    return this.request<StoryRecord | undefined>(STORIES, 'readonly', (store) => store.get(id));
  }

  async addStory(record: NewStoryRecord): Promise<StoryRecord> {
    const id = await this.request<IDBValidKey>(STORIES, 'readwrite', (store) => store.add(record));
    return { ...record, id: id as number };
  }

  async putStory(record: StoryRecord) {
    await this.request(STORIES, 'readwrite', (store) => store.put(record));
    return record;
  }

  deleteStory(id: number) {
    return this.request(STORIES, 'readwrite', (store) => store.delete(id));
  }

  /** Finds a story by its author and Signal timestamp */
  findStory(authorAci: string, sentAt: number) {
    return this.request<StoryRecord | undefined>(
      STORIES, 'readonly', (store) => store.index(BY_AUTHOR_SENT_AT).get([authorAci, sentAt]),
    );
  }

  /** Every stored story in arrival order; stories last a day, so there are few */
  getStories() {
    return this.request<StoryRecord[]>(STORIES, 'readonly', (store) => store.getAll());
  }

  /** Stories whose day ran out by `time` */
  getExpiredStories(time: number) {
    return this.request<StoryRecord[]>(
      STORIES, 'readonly', (store) => store.index(BY_EXPIRES_AT).getAll(IDBKeyRange.upperBound(time)),
    );
  }

  /** The earliest time a story expires */
  async getNextStoryExpiresAt() {
    const story = await this.request<StoryRecord | undefined>(
      STORIES, 'readonly', (store) => store.index(BY_EXPIRES_AT).get(IDBKeyRange.lowerBound(0)),
    );
    return story?.expiresAt;
  }

  async clear() {
    await this.request(CONVERSATIONS, 'readwrite', (store) => store.clear());
    await this.request(MESSAGES, 'readwrite', (store) => store.clear());
    await this.request(STORIES, 'readwrite', (store) => store.clear());
  }

  private open() {
    if (this.db) return this.db;

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open(DB_NAME, DB_VERSION);
      let isFailed = false;
      // A failed open is not kept, so that the next request opens the database again
      const fail = (err: unknown) => {
        isFailed = true;
        if (this.db === opening) this.db = undefined;
        reject(err);
      };
      openRequest.onupgradeneeded = ({ oldVersion }) => {
        const db = openRequest.result;
        if (oldVersion < 1) {
          db.createObjectStore(CONVERSATIONS, { keyPath: 'id' });
          const messages = db.createObjectStore(MESSAGES, { keyPath: 'id', autoIncrement: true });
          messages.createIndex(BY_CONVERSATION, ['conversationId', 'id']);
          messages.createIndex(BY_AUTHOR_SENT_AT, ['authorAci', 'sentAt']);
          messages.createIndex(BY_EXPIRES_AT, 'expiresAt');
        }
        if (oldVersion < 2) {
          const conversations = openRequest.transaction!.objectStore(CONVERSATIONS);
          conversations.createIndex(BY_LOCAL_ID, 'localId', { unique: true });
          // Conversations stored before local ids get them in creation order of the cursor
          let nextLocalId = 1;
          conversations.openCursor().onsuccess = ({ target }) => {
            const cursor = (target as IDBRequest<IDBCursorWithValue | undefined>).result;
            if (!cursor) return;
            cursor.update({ ...cursor.value, localId: nextLocalId++ });
            cursor.continue();
          };
        }
        if (oldVersion < 3) {
          const stories = db.createObjectStore(STORIES, { keyPath: 'id', autoIncrement: true });
          stories.createIndex(BY_AUTHOR_SENT_AT, ['authorAci', 'sentAt']);
          stories.createIndex(BY_EXPIRES_AT, 'expiresAt');
        }
      };
      // An older version of the app in another tab keeps the upgrade waiting until that tab closes
      openRequest.onblocked = () => fail(new Error('Close the other tabs of the app to update its database'));
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        // A request that failed meanwhile opens its own connection
        if (isFailed) {
          db.close();
          return;
        }
        // A newer version of the app in another tab upgrades the database once this connection is closed
        db.onversionchange = () => {
          db.close();
          if (this.db === opening) this.db = undefined;
        };
        resolve(db);
      };
      openRequest.onerror = () => fail(openRequest.error);
    });
    this.db = opening;
    return opening;
  }

  private async request<T>(
    storeName: string, mode: IDBTransactionMode, build: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = build(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }

  /** Walks a cursor while `callback` returns `true` */
  private async iterate(
    storeName: string,
    mode: IDBTransactionMode,
    // Key cursors work too when `callback` reads only `key`
    build: (store: IDBObjectStore) => IDBRequest,
    callback: (cursor: IDBCursorWithValue) => boolean,
  ) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const request = build(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => {
        const cursor = request.result as IDBCursorWithValue | undefined;
        if (!cursor || !callback(cursor)) {
          resolve();
          return;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
}
