export type ConversationType = 'private' | 'group';

export type ConversationRecord = {
  // The ACI of a private conversation, or the base64 group identifier of a group
  id: string;
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
  username?: string;
  // Groups
  masterKey?: Uint8Array;
  revision?: number;
  title?: string;
  description?: string;
  memberAcis?: string[];
  adminAcis?: string[];
  isAnnouncementsOnly?: boolean;
  // Both
  expireTimer?: number;
  expireTimerVersion?: number;
  lastMessageId?: number;
  lastMessageAt?: number;
  unreadCount: number;
  isArchived?: boolean;
  isMarkedUnread?: boolean;
  isBlocked?: boolean;
  // Whether we accepted the message request, or wrote first
  isAccepted?: boolean;
  mutedUntil?: number;
  // Position in the pinned conversations list
  pinIndex?: number;
  pinnedMessages?: { messageId: number; pinnedAt: number; expiresAt?: number }[];
};

export type MessageKind = 'message' | 'timerUpdate' | 'groupUpdate';

export type SendStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'viewed' | 'failed';

export type MessageRecord = {
  id: number;
  conversationId: string;
  kind: MessageKind;
  // Empty for notices, so that they never match a lookup by author and timestamp; see `actorAci`
  authorAci: string;
  // Who caused a notice, such as a timer change
  actorAci?: string;
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
  // Delivery state per recipient of an outgoing message
  recipientStatus?: Record<string, SendStatus>;
  isSealedSender?: boolean;
};

export type NewMessageRecord = Omit<MessageRecord, 'id'>;

const DB_NAME = 'ts-signal-messages';
const DB_VERSION = 1;
const CONVERSATIONS = 'conversations';
const MESSAGES = 'messages';
const BY_CONVERSATION = 'byConversation';
const BY_AUTHOR_SENT_AT = 'byAuthorSentAt';
const BY_EXPIRES_AT = 'byExpiresAt';

/**
 * Conversations and messages of the linked device in IndexedDB. Message ids grow in arrival order,
 * which is the order Signal Desktop shows messages in.
 */
export default class MessageDb {
  private db?: Promise<IDBDatabase>;

  getConversation(id: string) {
    return this.request<ConversationRecord | undefined>(CONVERSATIONS, 'readonly', (store) => store.get(id));
  }

  getConversations() {
    return this.request<ConversationRecord[]>(CONVERSATIONS, 'readonly', (store) => store.getAll());
  }

  async putConversation(record: ConversationRecord) {
    await this.request(CONVERSATIONS, 'readwrite', (store) => store.put(record));
    return record;
  }

  getMessage(id: number) {
    return this.request<MessageRecord | undefined>(MESSAGES, 'readonly', (store) => store.get(id));
  }

  async addMessage(record: NewMessageRecord): Promise<MessageRecord> {
    const id = await this.request<IDBValidKey>(MESSAGES, 'readwrite', (store) => store.add(record));
    return { ...record, id: id as number };
  }

  async putMessage(record: MessageRecord) {
    await this.request(MESSAGES, 'readwrite', (store) => store.put(record));
    return record;
  }

  deleteMessage(id: number) {
    return this.request(MESSAGES, 'readwrite', (store) => store.delete(id));
  }

  /** Deletes every message of a conversation and returns their ids */
  async deleteConversationMessages(conversationId: string) {
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER]);
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

  async clear() {
    await this.request(CONVERSATIONS, 'readwrite', (store) => store.clear());
    await this.request(MESSAGES, 'readwrite', (store) => store.clear());
  }

  private open() {
    this.db ??= new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(DB_NAME, DB_VERSION);
      openRequest.onupgradeneeded = () => {
        const db = openRequest.result;
        db.createObjectStore(CONVERSATIONS, { keyPath: 'id' });
        const messages = db.createObjectStore(MESSAGES, { keyPath: 'id', autoIncrement: true });
        messages.createIndex(BY_CONVERSATION, ['conversationId', 'id']);
        messages.createIndex(BY_AUTHOR_SENT_AT, ['authorAci', 'sentAt']);
        messages.createIndex(BY_EXPIRES_AT, 'expiresAt');
      };
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
    return this.db;
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
    build: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>,
    callback: (cursor: IDBCursorWithValue) => boolean,
  ) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const request = build(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => {
        const cursor = request.result;
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
