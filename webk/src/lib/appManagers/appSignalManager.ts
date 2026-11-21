/*
 * TeleSignal: Web K on the Signal engine.
 *
 * The managers of Web K were written for Telegram's API, which this app does not use: `ApiManager.invokeApi` hands
 * every method to `invoke` here, which answers it from the Signal provider that Web A uses as well
 * (`@signal-app/provider`, `src/api/signal` of the repository), in Telegram's shapes (`@lib/signal/builders`). The
 * provider's updates come back as Telegram updates through `apiUpdatesManager`. The engine keeps the account,
 * messages and attachments in its own stores, which both frontends open, so the managers' caches only mirror them.
 */

import type {
  Chat,
  Dialog,
  InputDialogPeer,
  InputPeer,
  InputUser,
  Message,
  MessagesDialogs,
  MessagesMessages,
  MethodDeclMap,
  Peer,
  Update,
  Updates,
  User
} from '@layer';
import type {
  SignalApiUpdate,
  SignalChat,
  SignalChats,
  SignalInitialArgs,
  SignalMessage,
  SignalUser
} from '@lib/signal/signalApi';
import {AppManager} from '@appManagers/manager';
import {buildChat, buildDialog, buildMessage, buildPeer, buildUser, isGroupPeerId} from '@lib/signal/builders';
import makeError from '@helpers/makeError';
import tsNow from '@helpers/tsNow';
import deferredPromise, {CancellablePromise} from '@helpers/cancellablePromise';

export type SignalLinkCode = {url: string, expires: number};

type MethodHandler = (params: any) => Promise<any> | any;

type PendingSend = {
  randomId: string,
  deferred: CancellablePromise<Updates>
};

const UNSUPPORTED_ERROR = 'SIGNAL_METHOD_UNSUPPORTED';
const DIALOGS_PAGE_LIMIT = 100;
// * the provider's local ids of messages being sent: the chat's last id plus a fraction, as Web A makes them
const LOCAL_ID_STEP = 1e-4;
// * a sent message replaces its local one in Web K once the engine stored it, which takes no network round trip
const SEND_TIMEOUT_MS = 60e3;

let provider: Promise<typeof import('@signal-app/provider')>;

export default class AppSignalManager extends AppManager {
  private linkCode: SignalLinkCode;
  private isStarted: boolean;
  private isAuthorized: boolean;
  private pendingSends: Map<number, PendingSend> = new Map();
  private localIdCounter = 0;
  private handlers: {[method in keyof MethodDeclMap]?: MethodHandler};

  constructor() {
    super();
    this.name = 'SIGNAL';
    this.handlers = this.createHandlers();
  }

  /**
   * Starts the engine of this account slot, or takes it over from the other frontend's tab that runs it (the
   * engine lock in `src/lib/signal/engineLock.ts`). Called by every tab that opens, after its passcode check.
   */
  public async start(args: Omit<SignalInitialArgs, 'userAgent'>) {
    // * one engine per worker: the slots of the other accounts are not supported yet
    if(this.getAccountNumber() !== 1) {
      return;
    }

    const {initApi} = await getProvider();
    this.isStarted = true;
    await initApi(this.onUpdate, {...args, userAgent: navigator.userAgent});
  }

  public getLinkCode() {
    return this.linkCode;
  }

  public invoke<T extends keyof MethodDeclMap>(method: T, params: MethodDeclMap[T]['req']): Promise<MethodDeclMap[T]['res']> {
    const handler = this.handlers[method];
    if(!handler) {
      this.log.warn('unsupported method', method, params);
      return Promise.reject(makeError(UNSUPPORTED_ERROR as ErrorType));
    }

    return Promise.resolve().then(() => handler(params));
  }

  public async logOut() {
    if(!this.isStarted) {
      return;
    }

    await this.call('destroy');
  }

  private async call<T = any>(name: string, ...args: any[]): Promise<T> {
    const {callApi} = await getProvider();
    return callApi(name, ...args);
  }

  /* ---------- methods ---------- */

  private createHandlers(): AppSignalManager['handlers'] {
    const now = () => tsNow(true);
    return {
      'help.getConfig': () => this.getConfig(),
      'help.getAppConfig': () => ({_: 'help.appConfig', hash: 1, config: {_: 'jsonObject', value: []}}),
      'help.getNearestDc': () => ({_: 'nearestDc', country: '', this_dc: 2, nearest_dc: 2}),
      'help.getPeerColors': () => ({_: 'help.peerColorsNotModified'}),
      'help.getPeerProfileColors': () => ({_: 'help.peerColorsNotModified'}),
      'help.getTimezonesList': () => ({_: 'help.timezonesList', timezones: [], hash: 0}),
      'help.getPromoData': () => ({_: 'help.promoDataEmpty', expires: now() + 86400}),
      'help.getCountriesList': () => ({_: 'help.countriesList', countries: [], hash: 0}),
      'help.getPremiumPromo': () => Promise.reject(makeError(UNSUPPORTED_ERROR as ErrorType)),
      'updates.getState': () => ({_: 'updates.state', pts: 1, qts: 0, date: now(), seq: 1, unread_count: 0}),
      'updates.getDifference': () => ({_: 'updates.differenceEmpty', date: now(), seq: 1}),
      'account.updateStatus': () => true,
      'account.getContentSettings': () => ({_: 'account.contentSettings', pFlags: {}}),
      'account.getGlobalPrivacySettings': () => ({_: 'globalPrivacySettings', pFlags: {}}),
      'account.getNotifySettings': () => ({_: 'peerNotifySettings'}),
      'account.registerDevice': () => true,
      'account.unregisterDevice': () => true,
      'langpack.getLangPack': () => Promise.reject(makeError(UNSUPPORTED_ERROR as ErrorType)),
      'langpack.getDifference': () => Promise.reject(makeError(UNSUPPORTED_ERROR as ErrorType)),
      'messages.getDialogFilters': () => ({_: 'messages.dialogFilters', pFlags: {}, filters: [{_: 'dialogFilterDefault'}]}),
      'messages.getSuggestedDialogFilters': () => [],
      'messages.getDialogs': (params) => this.getDialogs(params),
      'messages.getPinnedDialogs': (params) => this.getPinnedDialogs(params),
      'messages.getPeerDialogs': (params) => this.getPeerDialogs(params),
      'messages.getHistory': (params) => this.getHistory(params),
      'messages.sendMessage': (params) => this.sendMessage(params),
      'messages.readHistory': (params) => this.readHistory(params),
      'messages.setTyping': (params) => this.setTyping(params),
      'messages.deleteMessages': (params) => this.deleteMessages(params),
      'messages.editMessage': (params) => this.editMessage(params),
      'messages.getFullChat': (params) => this.getFullChat(params),
      'messages.getChats': (params) => this.getChats(params),
      'messages.getMessages': () => ({_: 'messages.messages', messages: [], chats: [], users: [], topics: []}),
      'messages.getScheduledHistory': () => ({_: 'messages.messages', messages: [], chats: [], users: [], topics: []}),
      'messages.getSavedDialogs': () => ({_: 'messages.savedDialogs', dialogs: [], messages: [], chats: [], users: []}),
      'messages.getStickerSet': () => Promise.reject(makeError('STICKERSET_INVALID' as ErrorType)),
      'users.getFullUser': (params) => this.getFullUser(params),
      'users.getUsers': (params) => this.getUsers(params),
      'contacts.getContacts': () => this.getContacts(),
      'contacts.getTopPeers': () => ({_: 'contacts.topPeersDisabled'}),
      'contacts.getBlocked': () => ({_: 'contacts.blocked', blocked: [], chats: [], users: []}),
      'stories.getAllStories': () => ({
        _: 'stories.allStories',
        pFlags: {},
        count: 0,
        state: '',
        peer_stories: [],
        chats: [],
        users: [],
        stealth_mode: {_: 'storiesStealthMode', pFlags: {}}
      })
    };
  }

  private getConfig() {
    const now = tsNow(true);
    return {
      _: 'config',
      pFlags: {},
      date: now,
      expires: now + 3600,
      test_mode: false,
      this_dc: 2,
      dc_options: [],
      dc_txt_domain_name: '',
      chat_size_max: 1000,
      megagroup_size_max: 1000,
      forwarded_count_max: 100,
      online_update_period_ms: 210000,
      offline_blur_timeout_ms: 5000,
      offline_idle_timeout_ms: 30000,
      online_cloud_timeout_ms: 300000,
      notify_cloud_delay_ms: 30000,
      notify_default_delay_ms: 1500,
      push_chat_period_ms: 60000,
      push_chat_limit: 2,
      // * Signal Android: messages can be edited and deleted for everyone for 24 hours
      edit_time_limit: 86400,
      revoke_time_limit: 86400,
      revoke_pm_time_limit: 86400,
      rating_e_decay: 2419200,
      stickers_recent_limit: 200,
      channels_read_media_period: 604800,
      call_receive_timeout_ms: 20000,
      call_ring_timeout_ms: 90000,
      call_connect_timeout_ms: 30000,
      call_packet_timeout_ms: 10000,
      me_url_prefix: '',
      caption_length_max: 4096,
      message_length_max: 4096,
      webfile_dc_id: 2
    } as MethodDeclMap['help.getConfig']['res'];
  }

  private async getDialogs(params: MethodDeclMap['messages.getDialogs']['req']): Promise<MessagesDialogs> {
    const offsetPeerId = getInputPeerId(params.offset_peer);
    const isFirstPage = !params.offset_date && !offsetPeerId;
    const result: SignalChats = await this.call('fetchChats', {
      limit: params.limit || DIALOGS_PAGE_LIMIT,
      offsetDate: isFirstPage ? undefined : params.offset_date,
      offsetPeer: isFirstPage || !offsetPeerId ? undefined : {id: '' + offsetPeerId},
      archived: params.folder_id === 1,
      withPinned: isFirstPage
    });

    if(!result) {
      return {_: 'messages.dialogs', dialogs: [], messages: [], chats: [], users: []};
    }

    const built = this.buildChats(result);
    return {
      _: 'messages.dialogsSlice',
      count: result.isFullyLoaded && isFirstPage ? built.dialogs.length : result.totalChatCount,
      ...built
    };
  }

  private async getPinnedDialogs(params: MethodDeclMap['messages.getPinnedDialogs']['req']) {
    const result: SignalChats = await this.call('fetchChats', {
      limit: 0,
      archived: params.folder_id === 1,
      withPinned: true
    });

    const built = result ? this.buildChats(result) : {dialogs: [] as Dialog[], messages: [] as Message[], chats: [] as Chat[], users: [] as User[]};
    return {
      _: 'messages.peerDialogs',
      ...built,
      dialogs: built.dialogs.filter((dialog) => dialog.pFlags.pinned),
      state: {_: 'updates.state', pts: 1, qts: 0, date: tsNow(true), seq: 1, unread_count: 0}
    } as MethodDeclMap['messages.getPinnedDialogs']['res'];
  }

  private async getPeerDialogs(params: MethodDeclMap['messages.getPeerDialogs']['req']) {
    const peerIds = new Set(params.peers.map((peer: InputDialogPeer) => {
      return peer._ === 'inputDialogPeer' ? '' + getInputPeerId(peer.peer) : undefined;
    }));
    const [main, archived]: SignalChats[] = await Promise.all([
      this.call('fetchChats', {limit: Number.MAX_SAFE_INTEGER, withPinned: true}),
      this.call('fetchChats', {limit: Number.MAX_SAFE_INTEGER, archived: true, withPinned: true})
    ]);

    const dialogs: Dialog[] = [];
    const messages: Message[] = [];
    const chats: Chat[] = [];
    const users: User[] = [];
    [main, archived].filter(Boolean).forEach((result) => {
      const built = this.buildChats(result);
      built.dialogs.forEach((dialog) => {
        if(peerIds.has('' + getPeerIdOfPeer(dialog.peer))) {
          dialogs.push(dialog);
        }
      });
      messages.push(...built.messages);
      chats.push(...built.chats);
      users.push(...built.users);
    });

    return {
      _: 'messages.peerDialogs',
      dialogs,
      messages,
      chats,
      users,
      state: {_: 'updates.state', pts: 1, qts: 0, date: tsNow(true), seq: 1, unread_count: 0}
    } as MethodDeclMap['messages.getPeerDialogs']['res'];
  }

  private buildChats(result: SignalChats) {
    const pinnedIds = new Set(result.orderedPinnedIds);
    const chatsById = new Map(result.chats.map((chat) => [chat.id, chat]));
    const dialogs = result.chatIds.map((chatId) => buildDialog({
      chat: chatsById.get(chatId),
      readState: result.threadReadStatesById[chatId],
      topMessageId: result.lastMessageByChatId[chatId],
      notifySettings: result.notifyExceptionById[chatId],
      isPinned: pinnedIds.has(chatId)
    }));

    return {
      dialogs,
      messages: result.messages.map(buildMessage),
      chats: result.chats.filter((chat) => isGroupPeerId(chat.id)).map(buildChat),
      users: result.users.map(buildUser)
    };
  }

  private async getHistory(params: MethodDeclMap['messages.getHistory']['req']): Promise<MessagesMessages> {
    const peerId = getInputPeerId(params.peer);
    const result: {messages: SignalMessage[], users: SignalUser[], count: number} = await this.call('fetchMessages', {
      chat: {id: '' + peerId},
      offsetId: params.offset_id || undefined,
      addOffset: params.add_offset || 0,
      limit: params.limit
    });

    if(!result) {
      return {_: 'messages.messages', messages: [], chats: [], users: [], topics: []};
    }

    const chats = await this.getChatsOfPeer(peerId);
    return {
      _: 'messages.messagesSlice',
      pFlags: {},
      count: result.count,
      messages: result.messages.map(buildMessage),
      chats,
      users: result.users.map(buildUser),
      topics: []
    };
  }

  private async getChatsOfPeer(peerId: PeerId): Promise<Chat[]> {
    if(!isGroupPeerId(peerId)) {
      return [];
    }

    const chat = this.appChatsManager.getChat((-peerId) as ChatId);
    return chat ? [chat] : [];
  }

  private sendMessage(params: MethodDeclMap['messages.sendMessage']['req']): Promise<Updates> {
    const peerId = getInputPeerId(params.peer);
    const replyTo = params.reply_to?._ === 'inputReplyToMessage' ? params.reply_to.reply_to_msg_id : undefined;
    const lastMessageId = this.appMessagesManager.getHistoryStorage(peerId.toPeerId()).maxId || 0;
    const localId = lastMessageId + LOCAL_ID_STEP * (++this.localIdCounter % (1 / LOCAL_ID_STEP));
    const chatId = '' + peerId;
    const entities = (params.entities || []).map((entity) => buildSignalEntity(entity)).filter(Boolean);
    const localMessage: SignalMessage = {
      id: localId,
      chatId,
      content: {text: {text: params.message, entities}},
      date: tsNow(true),
      isOutgoing: true,
      replyInfo: replyTo ? {type: 'message', replyToMsgId: replyTo} : undefined
    };

    const deferred = deferredPromise<Updates>();
    this.pendingSends.set(localId, {randomId: '' + params.random_id, deferred});
    const timeout = setTimeout(() => {
      this.pendingSends.delete(localId);
      deferred.reject(makeError('SIGNAL_SEND_TIMEOUT' as ErrorType));
    }, SEND_TIMEOUT_MS);
    deferred.finally(() => clearTimeout(timeout));

    this.call('sendMessage', {
      chat: {id: chatId},
      text: params.message,
      entities,
      replyInfo: localMessage.replyInfo,
      lastMessageId,
      localMessage
    }).catch((err) => {
      this.pendingSends.delete(localId);
      deferred.reject(err);
    });

    return deferred;
  }

  private async readHistory(params: MethodDeclMap['messages.readHistory']['req']) {
    await this.call('markMessageListRead', {chat: {id: '' + getInputPeerId(params.peer)}, threadId: -1, maxId: params.max_id});
    return {_: 'messages.affectedMessages', pts: 0, pts_count: 0};
  }

  private async setTyping(params: MethodDeclMap['messages.setTyping']['req']) {
    const type = params.action._ === 'sendMessageTypingAction' ? 'typing' : (params.action._ === 'sendMessageCancelAction' ? 'cancel' : undefined);
    if(type) {
      await this.call('sendMessageAction', {peer: {id: '' + getInputPeerId(params.peer)}, action: {type}});
    }

    return true;
  }

  private async deleteMessages(params: MethodDeclMap['messages.deleteMessages']['req']) {
    await this.call('deleteMessages', {messageIds: params.id, shouldDeleteForAll: params.revoke});
    return {_: 'messages.affectedMessages', pts: 0, pts_count: 0};
  }

  private async editMessage(params: MethodDeclMap['messages.editMessage']['req']) {
    const peerId = getInputPeerId(params.peer);
    await this.call('editMessage', {
      chat: {id: '' + peerId},
      message: {id: params.id, chatId: '' + peerId},
      text: params.message,
      entities: (params.entities || []).map((entity) => buildSignalEntity(entity)).filter(Boolean)
    });
    // * the edit comes back as an update once the engine stored it
    return {_: 'updates', updates: [], users: [], chats: [], date: tsNow(true), seq: 0} as Updates;
  }

  private async getFullChat(params: MethodDeclMap['messages.getFullChat']['req']) {
    const chat = this.appChatsManager.getChat(params.chat_id);
    const result: {fullInfo: {about?: string, members?: {userId: string}[]}, users: SignalUser[]} = await this.call('fetchFullChat', {id: '-' + params.chat_id});
    const users = (result?.users || []).map(buildUser);
    return {
      _: 'messages.chatFull',
      full_chat: {
        _: 'chatFull',
        pFlags: {},
        id: params.chat_id,
        about: result?.fullInfo.about || '',
        participants: {
          _: 'chatParticipants',
          chat_id: params.chat_id,
          participants: (result?.fullInfo.members || []).map(({userId}) => ({
            _: 'chatParticipant',
            user_id: +userId,
            inviter_id: 0,
            date: 0
          })),
          version: 0
        },
        notify_settings: {_: 'peerNotifySettings'},
        exported_invite: undefined
      },
      chats: chat ? [chat] : [],
      users
    } as MethodDeclMap['messages.getFullChat']['res'];
  }

  private async getChats(params: MethodDeclMap['messages.getChats']['req']) {
    return {
      _: 'messages.chats',
      chats: params.id.map((id) => this.appChatsManager.getChat(id)).filter(Boolean)
    } as MethodDeclMap['messages.getChats']['res'];
  }

  private async getFullUser(params: MethodDeclMap['users.getFullUser']['req']) {
    const userId = getInputUserId(params.id);
    const result: {user: SignalUser, fullInfo: {bio?: string, isBlocked?: boolean, ttlPeriod?: number}} = await this.call('fetchFullUser', {id: '' + userId});
    if(!result) {
      throw makeError('USER_ID_INVALID' as ErrorType);
    }

    return {
      _: 'users.userFull',
      full_user: {
        _: 'userFull',
        pFlags: {
          blocked: result.fullInfo.isBlocked || undefined
        },
        id: userId,
        about: result.fullInfo.bio,
        settings: {_: 'peerSettings', pFlags: {}},
        notify_settings: {_: 'peerNotifySettings'},
        common_chats_count: 0,
        ttl_period: result.fullInfo.ttlPeriod
      },
      chats: [],
      users: [buildUser(result.user)]
    } as MethodDeclMap['users.getFullUser']['res'];
  }

  private async getUsers(params: MethodDeclMap['users.getUsers']['req']) {
    const result: {users: SignalUser[]} = await this.call('fetchUsers', {
      users: params.id.map((inputUser) => ({id: '' + getInputUserId(inputUser)}))
    });
    return (result?.users || []).map(buildUser);
  }

  private async getContacts() {
    const result: {users: SignalUser[]} = await this.call('fetchContactList');
    const users = (result?.users || []).map(buildUser);
    return {
      _: 'contacts.contacts',
      contacts: users.map((user) => ({_: 'contact', user_id: user.id, mutual: false})),
      saved_count: 0,
      users
    } as MethodDeclMap['contacts.getContacts']['res'];
  }

  /* ---------- updates ---------- */

  private onUpdate = (update: SignalApiUpdate) => {
    try {
      this.handleUpdate(update);
    } catch(err) {
      this.log.error('update failed', update, err);
    }
  };

  private handleUpdate(update: SignalApiUpdate) {
    switch(update['@type']) {
      case 'updateAuthorizationState':
        this.onAuthorizationState(update);
        break;
      case 'updateCurrentUser':
        this.onCurrentUser(update.currentUser);
        break;
      case 'updateEntities':
        if(update.users) {
          this.appUsersManager.saveApiUsers(Object.values(update.users as Record<string, SignalUser>).map(buildUser));
        }
        if(update.chats) {
          this.saveChats(Object.values(update.chats as Record<string, SignalChat>));
        }
        break;
      case 'updateUser':
        if(update.user) {
          this.appUsersManager.saveApiUsers([buildUser({...this.getCachedUser(update.id), ...update.user, id: update.id})]);
        }
        break;
      case 'updateChat':
        if(update.chat) {
          this.saveChats([update.chat]);
        }
        break;
      case 'newMessage':
        // * Web K shows its own message while one is sent: the provider's local one has a fractional id
        if(Number.isInteger(update.message.id)) {
          this.pushUpdates([{_: 'updateNewMessage', message: buildMessage(update.message), pts: 0, pts_count: 0}]);
        }
        break;
      case 'updateMessage':
        if(update.message?.content && update.message.chatId) {
          this.pushUpdates([{_: 'updateEditMessage', message: buildMessage(update.message as SignalMessage), pts: 0, pts_count: 0}]);
        }
        break;
      case 'updateMessageSendSucceeded':
        this.onMessageSent(update.localId, update.message);
        break;
      case 'updateMessageSendFailed':
        this.onMessageSendFailed(update.localId);
        break;
      case 'deleteMessages':
        this.pushUpdates([{_: 'updateDeleteMessages', messages: update.ids, pts: 0, pts_count: 0}]);
        break;
      case 'updateThreadReadState':
        this.onReadState(update.chatId, update.readState);
        break;
      case 'updateChatTypingStatus':
        this.onTyping(update.id, update.peerId, !!update.typingStatus);
        break;
      case 'updateChatNotifySettings':
        this.pushUpdates([{
          _: 'updateNotifySettings',
          peer: {_: 'notifyPeer', peer: buildPeer(update.chatId)},
          notify_settings: {_: 'peerNotifySettings', mute_until: update.settings?.mutedUntil}
        }]);
        break;
      case 'updatePinnedChatIds':
        this.pushUpdates([{
          _: 'updatePinnedDialogs',
          folder_id: update.folderId === 1 ? 1 : 0,
          order: (update.ids as string[]).map((id) => ({_: 'dialogPeer', peer: buildPeer(id)}))
        }]);
        break;
      default:
        break;
    }
  }

  private onAuthorizationState(update: SignalApiUpdate) {
    if(update.authorizationState === 'authorizationStateWaitQrCode' && update.qrCode) {
      this.linkCode = {url: update.qrCode.token, expires: update.qrCode.expires};
      this.rootScope.dispatchEvent('signal_link_code', this.linkCode);
    } else if(update.authorizationState === 'authorizationStateReady') {
      this.linkCode = undefined;
    }
  }

  /** The account is linked and its session runs: the user it shows from now on is ours */
  private onCurrentUser(signalUser: SignalUser) {
    const user = buildUser({...signalUser, isSelf: true});
    this.appUsersManager.saveApiUsers([user]);
    if(this.isAuthorized) {
      return;
    }

    this.isAuthorized = true;
    // * a page that shows the link screen goes on to the chats once the slot holds the account (`signal_authorized`)
    this.apiManager.setUser(user).then(() => {
      this.rootScope.dispatchEvent('signal_authorized', user.id.toUserId());
    });
  }

  private getCachedUser(userId: string): Partial<SignalUser> {
    const user = this.appUsersManager.getUser(+userId);
    return user ? {
      firstName: user.first_name,
      lastName: user.last_name,
      phoneNumber: user.phone,
      isSelf: user.pFlags.self
    } : {};
  }

  private saveChats(chats: SignalChat[]) {
    this.appChatsManager.saveApiChats(chats.filter((chat) => isGroupPeerId(chat.id)).map(buildChat));
  }

  private pushUpdates(updates: Update[], users: User[] = [], chats: Chat[] = []) {
    this.apiUpdatesManager.processUpdateMessage({
      _: 'updates',
      updates,
      users,
      chats,
      date: tsNow(true),
      seq: 0
    });
  }

  private onMessageSent(localId: number, message: SignalMessage) {
    const pending = this.pendingSends.get(localId);
    const built = buildMessage(message);
    if(!pending) {
      // * sent from Web A's other tab before this one took over, or a resend: a message like any other
      this.pushUpdates([{_: 'updateNewMessage', message: built, pts: 0, pts_count: 0}]);
      return;
    }

    this.pendingSends.delete(localId);
    pending.deferred.resolve({
      _: 'updates',
      updates: [
        {_: 'updateMessageID', id: message.id, random_id: pending.randomId},
        {_: 'updateNewMessage', message: built, pts: 0, pts_count: 0}
      ],
      users: [],
      chats: [],
      date: tsNow(true),
      seq: 0
    });
  }

  private onMessageSendFailed(localId: number) {
    const pending = this.pendingSends.get(localId);
    if(!pending) {
      return;
    }

    this.pendingSends.delete(localId);
    pending.deferred.reject(makeError('SIGNAL_SEND_FAILED' as ErrorType));
  }

  private onReadState(chatId: string, readState: {unreadCount?: number, lastReadInboxMessageId?: number, lastReadOutboxMessageId?: number}) {
    const peer = buildPeer(chatId);
    const updates: Update[] = [];
    if(readState.lastReadOutboxMessageId) {
      updates.push({_: 'updateReadHistoryOutbox', peer, max_id: readState.lastReadOutboxMessageId, pts: 0, pts_count: 0});
    }

    if(readState.lastReadInboxMessageId !== undefined || readState.unreadCount !== undefined) {
      updates.push({
        _: 'updateReadHistoryInbox',
        peer,
        max_id: readState.lastReadInboxMessageId || 0,
        still_unread_count: readState.unreadCount || 0,
        pts: 0,
        pts_count: 0
      });
    }

    if(updates.length) {
      this.pushUpdates(updates);
    }
  }

  private onTyping(chatId: string, userId: string, isTyping: boolean) {
    const action = {_: isTyping ? 'sendMessageTypingAction' : 'sendMessageCancelAction'} as const;
    if(isGroupPeerId(chatId)) {
      this.pushUpdates([{
        _: 'updateChatUserTyping',
        chat_id: -Number(chatId),
        from_id: buildPeer(userId),
        action
      }]);
    } else {
      this.pushUpdates([{_: 'updateUserTyping', user_id: +userId, action}]);
    }
  }
}

function getProvider() {
  return provider ??= import('@signal-app/provider');
}

function getInputPeerId(inputPeer: InputPeer): PeerId {
  switch(inputPeer?._) {
    case 'inputPeerUser':
      return (+inputPeer.user_id) as PeerId;
    case 'inputPeerChat':
      return (-inputPeer.chat_id) as PeerId;
    default:
      return undefined;
  }
}

function getInputUserId(inputUser: InputUser): UserId {
  return inputUser._ === 'inputUser' ? +inputUser.user_id : undefined;
}

function getPeerIdOfPeer(peer: Peer) {
  switch(peer._) {
    case 'peerUser':
      return +peer.user_id;
    case 'peerChat':
      return -peer.chat_id;
    default:
      return undefined;
  }
}

// * Telegram's entity names with an upper-case first letter are Web A's `ApiMessageEntityTypes`
function buildSignalEntity(entity: MethodDeclMap['messages.sendMessage']['req']['entities'][number]) {
  const type = entity._.charAt(0).toUpperCase() + entity._.slice(1);
  return {
    type,
    offset: entity.offset,
    length: entity.length,
    url: (entity as {url?: string}).url,
    userId: (entity as {user_id?: UserId}).user_id ? '' + (entity as {user_id?: UserId}).user_id : undefined,
    language: (entity as {language?: string}).language
  };
}
