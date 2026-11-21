import { fromBinary, toBinary } from '@bufbuild/protobuf';

import type MessageDb from '../db/MessageDb';
import type MessageProcessor from '../messages/MessageProcessor';
import type { GroupChange } from '../proto/generated/Groups_pb';
import type SignalClient from '../SignalClient';
import type { GroupActions, GroupChangeBuilder, GroupChangeContext } from './buildGroupChange';
import type { GroupState } from './fetchGroup';
import type { GroupJoinInfo, NewGroup } from './groupRequests';

import { bufferToBase64 } from '../../../util/encoding/buffer';
import { pause } from '../../../util/schedulers';
import { isPniServiceId, toPniServiceId } from '../serviceId';
import { wasm } from '../wasm';
import { buildAvatarChange, checkGroupTitle, combineGroupChanges } from './buildGroupChange';
import { buildAccessControl, fetchGroup, GroupRequestError } from './fetchGroup';
import { applyGroupChange, decryptGroupChange } from './groupChange';
import {
  createGroupOnServer, fetchGroupJoinInfo, submitGroupChange, uploadGroupAvatar,
} from './groupRequests';
import { saveGroupSendEndorsements } from './groupSendEndorsements';
import { parseGroupInviteLink } from './inviteLinks';
import {
  createProfileKeyCredentialPresentation, forgetProfileKeyCredentials, getProfileKeyCredential,
} from './profileKeyCredentials';

import {
  AccessControl_AccessRequired, GroupChange_ActionsSchema, GroupChangeSchema, Member_Role,
} from '../proto/generated/Groups_pb';

export type GroupLinkPreview = GroupJoinInfo & {
  groupId: string;
  // Our conversation with the group, when we know it already
  conversationId?: string;
};

// Signal Desktop `modifyGroupV2`: attempts after conflicts and after rejected profile key credentials
const MAX_ATTEMPTS = 5;
// How long an edit of the title, description or avatar waits for the others of the same save
const ATTRIBUTE_EDIT_WINDOW_MS = 50;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

/**
 * Changes groups v2 on the storage service (Signal Desktop `ts/groups.preload.ts`): each change is built from the
 * current state, submitted for the next revision, applied here with its notices, and sent to the members as a
 * group update. A conflict with a change of someone else fetches the state again and builds the change anew.
 */
export default class GroupManager {
  // Changes of one group run one at a time, so each builds on the revision the previous one made
  private queues = new Map<string, Promise<unknown>>();

  // Title, description and avatar edits that wait to go as one change
  private attributeEdits = new Map<string, { builders: GroupChangeBuilder[]; result: Promise<unknown> }>();

  constructor(
    private client: SignalClient,
    private db: MessageDb,
    private processor: MessageProcessor,
    private onError: (error: Error) => void,
  ) {}

  /** Applies a change to the group of conversation `id`; resolves without a change when `build` finds none */
  modifyGroup(id: string, build: GroupChangeBuilder) {
    return this.enqueue(id, () => this.runChange(id, build));
  }

  /**
   * Edits the title, description or avatar. Edits made together, as the app makes them from one save, go as one
   * change, like the group details screens of Signal clients do.
   */
  editAttributes(id: string, build: GroupChangeBuilder) {
    const pending = this.attributeEdits.get(id);
    if (pending) {
      pending.builders.push(build);
      return pending.result;
    }

    const builders = [build];
    const result = pause(ATTRIBUTE_EDIT_WINDOW_MS).then(() => {
      this.attributeEdits.delete(id);
      return this.modifyGroup(id, combineGroupChanges(...builders));
    });
    this.attributeEdits.set(id, { builders, result });
    return result;
  }

  /** Sets a new avatar, uploaded once for the change, or removes the avatar without `avatar` */
  setAvatar(id: string, avatar?: Uint8Array) {
    let avatarUrl: string | undefined;
    return this.editAttributes(id, async (state, context) => {
      if (avatar && !avatarUrl) {
        const { account, connection } = this.client.getSenderContext();
        avatarUrl = await uploadGroupAvatar(account, connection, context.secretParams, avatar);
      }
      return buildAvatarChange(avatarUrl)(state, context);
    });
  }

  /**
   * Creates a group with us as its admin (Signal Desktop `createGroupV2`). Users whose profile key credential we
   * cannot get are invited; the server rejecting a credential fetches all of them once more.
   */
  async createGroup({ title: rawTitle, memberAcis, expireTimer }: {
    title: string; memberAcis: string[]; expireTimer?: number;
  }) {
    const title = rawTitle.trim();
    checkGroupTitle(title);
    const { store, account, connection } = this.client.getSenderContext();
    const others = [...new Set(memberAcis)].filter((aci) => aci !== account.aci);

    for (let attempt = 0; ; attempt++) {
      const selfCredential = await getProfileKeyCredential(store, connection, account.aci, account.profileKey);
      if (!selfCredential) throw new Error('Our profile key credential is missing');
      const credentials = await Promise.all(others.map((aci) => getProfileKeyCredential(store, connection, aci)));
      const group: NewGroup = {
        title,
        expireTimer,
        memberCredentials: credentials.filter(Boolean),
        invitedAcis: others.filter((_, index) => !credentials[index]),
      };

      let created: Awaited<ReturnType<typeof createGroupOnServer>>;
      try {
        created = await createGroupOnServer(account, connection, group, selfCredential);
      } catch (err) {
        if (attempt || !(err instanceof GroupRequestError) || err.status !== HTTP_BAD_REQUEST) throw err;
        await forgetProfileKeyCredentials(store, [account.aci, ...others]);
        continue;
      }

      const { masterKey, state, sendEndorsementsResponse } = created;
      const conversation = await this.processor.applyGroupState(masterKey, state, { isCreated: true });
      await this.saveEndorsements(conversation.id, masterKey, state, sendEndorsementsResponse);
      await this.processor.sendGroupUpdate(conversation.id);
      return conversation;
    }
  }

  /** What a group link leads to, before joining (Signal Desktop `getPreJoinGroupInfo`) */
  async previewGroupLink(link: string): Promise<GroupLinkPreview> {
    const { masterKey, inviteLinkPassword } = parseLink(link);
    const { account, connection } = this.client.getSenderContext();
    const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
    const groupId = getGroupId(secretParams);
    const info = await fetchGroupJoinInfo(account, connection, secretParams, inviteLinkPassword);
    const conversation = await this.db.getConversation(groupId);
    return { ...info, groupId, conversationId: conversation?.id };
  }

  /**
   * Joins through a group link, or asks to join when the link needs admin approval (Signal Desktop
   * `ts/groups/joinViaLink.preload.ts`). Without a state we may read before approval, the conversation keeps
   * what the link shows.
   */
  joinGroupByLink(link: string) {
    const { masterKey, inviteLinkPassword } = parseLink(link);
    const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
    const groupId = getGroupId(secretParams);
    return this.enqueue(groupId, () => this.runJoin(groupId, masterKey, inviteLinkPassword));
  }

  private enqueue<T>(id: string, task: () => Promise<T>) {
    const result = (this.queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(task);
    this.queues.set(id, result);
    void result.catch(() => undefined).then(() => {
      if (this.queues.get(id) === result) this.queues.delete(id);
    });
    return result;
  }

  private async runJoin(groupId: string, masterKey: Uint8Array, inviteLinkPassword: Uint8Array) {
    const { store, account, connection } = this.client.getSenderContext();
    const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
    const existing = await this.db.getConversation(groupId);
    if (existing?.memberAcis?.includes(account.aci)) return existing;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const info = await fetchGroupJoinInfo(account, connection, secretParams, inviteLinkPassword);
      // We asked to join before, maybe on another device
      if (info.isPendingApproval) {
        return existing ?? this.processor.applyGroupState(
          masterKey, buildRequestedState(info, info.revision, account.aci), {},
        );
      }
      const credential = await getProfileKeyCredential(store, connection, account.aci, account.profileKey);
      if (!credential) throw new Error('Our profile key credential is missing');
      const presentation = createProfileKeyCredentialPresentation(secretParams, credential);
      const actions: GroupActions = info.isApprovalRequired
        ? { addMembersPendingAdminApproval: [{ added: { presentation } }] }
        : { addMembers: [{ added: { role: Member_Role.DEFAULT, presentation }, joinFromInviteLink: true }] };
      actions.version = info.revision + 1;

      let response: Awaited<ReturnType<typeof submitGroupChange>>;
      try {
        response = await submitGroupChange(account, connection, secretParams, actions, inviteLinkPassword);
      } catch (err) {
        if (!(err instanceof GroupRequestError) || err.status !== HTTP_CONFLICT) throw err;
        continue;
      }

      const { groupChange, sendEndorsementsResponse } = response;
      const change = decryptGroupChange(secretParams, fromBinary(GroupChange_ActionsSchema, groupChange.actions));
      if (info.isApprovalRequired) {
        const requested = buildRequestedState(info, change.revision, account.aci);
        return this.processor.applyGroupState(masterKey, requested, { change });
      }

      const { state } = await fetchGroup(account, connection, masterKey);
      // The state brings the profile keys of the members, which we need to send to them
      const conversation = await this.processor.applyGroupState(masterKey, state, { change, isFetched: true });
      await this.saveEndorsements(groupId, masterKey, state, sendEndorsementsResponse);
      await this.processor.sendGroupUpdate(groupId, toBinary(GroupChangeSchema, groupChange));
      return conversation;
    }
    throw new Error('Joining the group conflicted with other changes too many times');
  }

  private async runChange(id: string, build: GroupChangeBuilder) {
    const { store, account, connection } = this.client.getSenderContext();
    let hasForgottenCredentials = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const conversation = await this.getGroupConversation(id);
      const masterKey = conversation.masterKey!;
      const state = conversation.groupState ?? (await this.processor.refreshGroup(id, masterKey))?.groupState;
      if (!state) throw new Error(`Group ${id} has no state`);

      const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
      const credentialAcis: string[] = [];
      const context: GroupChangeContext = {
        secretParams,
        selfAci: account.aci,
        selfPni: account.pni && toPniServiceId(account.pni),
        getCredential: (aci) => {
          credentialAcis.push(aci);
          return getProfileKeyCredential(
            store, connection, aci, aci === account.aci ? account.profileKey : undefined,
          );
        },
      };
      const actions = await build(state, context);
      if (!actions) return conversation;
      actions.version = state.revision + 1;

      let response: Awaited<ReturnType<typeof submitGroupChange>>;
      try {
        response = await submitGroupChange(account, connection, secretParams, actions);
      } catch (err) {
        if (!(err instanceof GroupRequestError)) throw err;
        if (err.status === HTTP_CONFLICT) {
          await this.processor.refreshGroup(id, masterKey);
        } else if (err.status === HTTP_BAD_REQUEST && credentialAcis.length && !hasForgottenCredentials) {
          // Stale profile key credentials: the next attempt fetches them again
          hasForgottenCredentials = true;
          await forgetProfileKeyCredentials(store, credentialAcis);
        } else {
          throw err;
        }
        continue;
      }
      const { groupChange, sendEndorsementsResponse } = response;
      return this.applyOwnChange(conversation.id, masterKey, state, groupChange, sendEndorsementsResponse);
    }
    throw new Error('The group change conflicted with other changes too many times');
  }

  /**
   * Applies the change the server accepted, stores the endorsements for the new members, and sends the change
   * to the members and to the people it removed
   */
  private async applyOwnChange(
    id: string,
    masterKey: Uint8Array,
    state: GroupState,
    groupChange: GroupChange,
    sendEndorsementsResponse?: Uint8Array,
  ) {
    const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
    const change = decryptGroupChange(secretParams, fromBinary(GroupChange_ActionsSchema, groupChange.actions));
    if (change.revision !== state.revision + 1) return this.processor.refreshGroup(id, masterKey);

    const next = applyGroupChange(state, change);
    const conversation = await this.processor.applyGroupState(masterKey, next, { change });
    await this.saveEndorsements(id, masterKey, next, sendEndorsementsResponse);
    await this.processor.sendGroupUpdate(id, toBinary(GroupChangeSchema, groupChange), [
      ...change.deleteMembers,
      ...change.deletePendingMembers,
      ...change.deleteRequestingMembers,
    ].filter((serviceId) => !isPniServiceId(serviceId)));
    return conversation;
  }

  /**
   * Endorsements only let sends to the group go as one message, so failing to save them must not keep us from
   * telling the members about a change the server accepted
   */
  private async saveEndorsements(id: string, masterKey: Uint8Array, state: GroupState, response?: Uint8Array) {
    try {
      const { store, account } = this.client.getSenderContext();
      await saveGroupSendEndorsements(
        store,
        account.aci,
        id,
        wasm.GroupSecretParams_DeriveFromMasterKey(masterKey),
        state.members.map(({ aci }) => aci),
        response,
      );
    } catch (err) {
      this.onError(err as Error);
    }
  }

  private async getGroupConversation(id: string) {
    const conversation = await this.db.getConversation(id);
    if (conversation?.type !== 'group' || !conversation.masterKey) throw new Error(`Unknown group ${id}`);
    return conversation;
  }
}

function parseLink(link: string) {
  const parsed = parseGroupInviteLink(link);
  if (!parsed) throw new Error('Invalid group link');
  return parsed;
}

function getGroupId(secretParams: Uint8Array) {
  const publicParams = wasm.GroupSecretParams_GetPublicParams(secretParams);
  return bufferToBase64(wasm.GroupPublicParams_GetGroupIdentifier(publicParams));
}

/** What we know of a group we asked to join: what its link shows, and our request */
function buildRequestedState(info: GroupJoinInfo, revision: number, selfAci: string): GroupState {
  return {
    revision,
    title: info.title,
    description: info.description,
    avatarUrl: info.avatarUrl,
    accessControl: { ...buildAccessControl(), addFromInviteLink: AccessControl_AccessRequired.ADMINISTRATOR },
    members: [],
    pendingMembers: [],
    requestingMembers: [{ aci: selfAci }],
    bannedMembers: [],
  };
}
