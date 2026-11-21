import type { MessageInitShape } from '@bufbuild/protobuf';

import type { GroupChange_ActionsSchema } from '../proto/generated/Groups_pb';
import type { GroupState } from './fetchGroup';

import { getRandomBytes } from '../crypto';
import { encryptGroupAttribute, encryptGroupServiceId } from './groupCipher';
import { createProfileKeyCredentialPresentation } from './profileKeyCredentials';

import { AccessControl_AccessRequired, Member_Role } from '../proto/generated/Groups_pb';

export type GroupActions = MessageInitShape<typeof GroupChange_ActionsSchema>;

export type GroupChangeContext = {
  secretParams: Uint8Array;
  selfAci: string;
  selfPni?: string;
  // The expiring profile key credential of a user, or `undefined` when the user has to be invited instead
  getCredential(aci: string): Promise<Uint8Array | undefined>;
};

/** Builds the actions of a change from the current state, or returns `undefined` when there is nothing to change */
export type GroupChangeBuilder = (
  state: GroupState, context: GroupChangeContext,
) => GroupActions | undefined | Promise<GroupActions | undefined>;

/** A change Signal clients do not make, such as a title over the length limit or the last admin leaving */
export class GroupChangeRefusedError extends Error {
  constructor(readonly reason: 'titleTooLong' | 'descriptionTooLong' | 'lastAdmin') {
    super(`Group change refused: ${reason}`);
  }
}

export type InviteLinkSettings = {
  isEnabled: boolean;
  isApprovalRequired?: boolean;
  // A new password makes earlier links stop working
  shouldReset?: boolean;
};

// Signal Desktop `ts/groups.preload.ts`
const GROUP_TITLE_MAX_ENCRYPTED_BYTES = 1024;
const GROUP_DESCRIPTION_MAX_ENCRYPTED_BYTES = 8192;
// Signal Android `RemoteConfig.maxGroupNameGraphemeLength` and `CreateProfileFragment.MAX_DESCRIPTION_GLYPHS`
export const GROUP_TITLE_MAX_GRAPHEMES = 32;
const GROUP_DESCRIPTION_MAX_GRAPHEMES = 480;
const INVITE_LINK_PASSWORD_LENGTH = 16;
// Signal Android `RemoteConfig.groupLimits` hard limit, which also bounds the banned list
const GROUP_SIZE_HARD_LIMIT = 1001;

export function buildTitleChange(title: string): GroupChangeBuilder {
  return (state, { secretParams }) => {
    if (state.title === title) return undefined;
    checkGroupTitle(title);
    const encrypted = encryptGroupAttribute(secretParams, { case: 'title', value: title });
    if (encrypted.length > GROUP_TITLE_MAX_ENCRYPTED_BYTES) throw new Error('Group title is too long');
    return { modifyTitle: { title: encrypted } };
  };
}

export function buildDescriptionChange(description: string): GroupChangeBuilder {
  return (state, { secretParams }) => {
    if ((state.description ?? '') === description) return undefined;
    checkGroupDescription(description);
    const encrypted = encryptGroupAttribute(secretParams, { case: 'descriptionText', value: description });
    if (encrypted.length > GROUP_DESCRIPTION_MAX_ENCRYPTED_BYTES) throw new Error('Group description is too long');
    return { modifyDescription: { description: encrypted } };
  };
}

/** `avatarUrl` is the CDN key from `uploadGroupAvatar`; without it the avatar is removed */
export function buildAvatarChange(avatarUrl?: string): GroupChangeBuilder {
  return (state) => (state.avatarUrl === avatarUrl ? undefined : { modifyAvatar: { avatar: avatarUrl ?? '' } });
}

export function buildExpireTimerChange(seconds: number): GroupChangeBuilder {
  return (state, { secretParams }) => ((state.expireTimer ?? 0) === seconds ? undefined : {
    modifyDisappearingMessageTimer: {
      timer: encryptGroupAttribute(secretParams, { case: 'disappearingMessagesDuration', value: seconds }),
    },
  });
}

/**
 * Adds users as full members with their profile key credentials; users without one are invited and join once
 * they accept. Banned users are unbanned (Signal Desktop `buildAddMembersChange`).
 */
export function buildAddMembersChange(acis: string[]): GroupChangeBuilder {
  return async (state, { secretParams, selfAci, getCredential }) => {
    const known = new Set([
      ...state.members.map(({ aci }) => aci),
      ...state.pendingMembers.map(({ serviceId }) => serviceId),
    ]);
    const added = [...new Set(acis)].filter((aci) => !known.has(aci));
    if (!added.length) return undefined;

    const revision = state.revision + 1;
    const users = await Promise.all(added.map(async (aci) => ({
      aci,
      userId: encryptGroupServiceId(secretParams, aci),
      credential: await getCredential(aci),
    })));
    const banned = new Set(state.bannedMembers.map(({ serviceId }) => serviceId));
    const requesting = new Set(state.requestingMembers.map(({ aci }) => aci));
    return {
      addMembers: users.filter(({ credential }) => credential).map(({ userId, credential }) => ({
        added: {
          userId,
          role: Member_Role.DEFAULT,
          presentation: createProfileKeyCredentialPresentation(secretParams, credential!),
          joinedAtVersion: revision,
        },
      })),
      addMembersPendingProfileKey: users.filter(({ credential }) => !credential).map(({ userId }) => ({
        added: {
          member: { userId, role: Member_Role.DEFAULT, joinedAtVersion: revision },
          addedByUserId: encryptGroupServiceId(secretParams, selfAci),
          timestamp: BigInt(Date.now()),
        },
      })),
      deleteMembersBanned: users.filter(({ aci }) => banned.has(aci)).map(({ userId }) => ({ deletedUserId: userId })),
      // Adding someone who asked to join answers the request
      deleteMembersPendingAdminApproval: users
        .filter(({ aci }) => requesting.has(aci))
        .map(({ userId }) => ({ deletedUserId: userId })),
    };
  };
}

/**
 * Removes a member, an invited user or a join request. With `shouldBan`, removed members and requesters cannot
 * join again through the group link (Signal Desktop `buildDeleteMemberChange`).
 */
export function buildRemoveMemberChange(serviceId: string, shouldBan?: boolean): GroupChangeBuilder {
  return (state, { secretParams, selfAci }) => {
    const userId = encryptGroupServiceId(secretParams, serviceId);
    const ban = shouldBan ? buildBanActions(state, secretParams, selfAci, serviceId) : {};
    if (state.members.some(({ aci }) => aci === serviceId)) {
      return { ...ban, deleteMembers: [{ deletedUserId: userId }] };
    }
    if (state.pendingMembers.some((member) => member.serviceId === serviceId)) {
      return { deleteMembersPendingProfileKey: [{ deletedUserId: userId }] };
    }
    if (state.requestingMembers.some(({ aci }) => aci === serviceId)) {
      return { ...ban, deleteMembersPendingAdminApproval: [{ deletedUserId: userId }] };
    }
    return undefined;
  };
}

/**
 * Leaves the group, or declines an invitation or a join request we sent (Signal Desktop `leaveGroupV2`).
 * Our PNI stays invited after we leave with our ACI. The only admin of a group with other members has to make
 * one of them an admin first (Signal Android `LeaveGroupDialog`).
 */
export function buildLeaveChange(): GroupChangeBuilder {
  return (state, context) => {
    const { selfAci, selfPni } = context;
    const isMember = state.members.some(({ aci }) => aci === selfAci);
    const others = state.members.filter(({ aci }) => aci !== selfAci);
    const isOnlyAdmin = state.members.some(({ aci, role }) => aci === selfAci && role === Member_Role.ADMINISTRATOR)
      && !others.some(({ role }) => role === Member_Role.ADMINISTRATOR);
    if (isOnlyAdmin && others.length) throw new GroupChangeRefusedError('lastAdmin');
    const invitedServiceId = [selfAci, selfPni].find((serviceId) => (
      serviceId && state.pendingMembers.some((member) => member.serviceId === serviceId)
    ));
    return buildRemoveMemberChange(isMember ? selfAci : invitedServiceId ?? selfAci)(state, context);
  };
}

/** Promotes an invitation of our ACI or PNI to membership with our profile key credential */
export function buildAcceptInvitationChange(): GroupChangeBuilder {
  return async (state, { secretParams, selfAci, selfPni, getCredential }) => {
    const pending = state.pendingMembers.find(({ serviceId }) => serviceId === selfAci || serviceId === selfPni);
    if (!pending) return undefined;
    const credential = await getCredential(selfAci);
    if (!credential) throw new Error('Our profile key credential is missing');

    const presentation = createProfileKeyCredentialPresentation(secretParams, credential);
    return pending.serviceId === selfAci
      ? { promoteMembersPendingProfileKey: [{ presentation }] }
      : { promoteMembersPendingPniAciProfileKey: [{ presentation }] };
  };
}

export function buildRoleChange(aci: string, isAdmin: boolean): GroupChangeBuilder {
  return (state, { secretParams }) => {
    const member = state.members.find((current) => current.aci === aci);
    const role = isAdmin ? Member_Role.ADMINISTRATOR : Member_Role.DEFAULT;
    if (!member || member.role === role) return undefined;

    const userId = encryptGroupServiceId(secretParams, aci);
    // Labels that only admins may set go with the admin role (Signal Desktop `buildModifyMemberRoleChange`)
    const shouldDropLabel = !isAdmin && member.label
      && state.accessControl.memberLabel === AccessControl_AccessRequired.ADMINISTRATOR;
    return {
      modifyMemberRoles: [{ userId, role }],
      modifyMemberLabels: shouldDropLabel ? [{ userId }] : [],
    };
  };
}

/** Who may edit the title, avatar, description and timer, and who may add members */
export function buildAccessChange(
  { isInfoAdminOnly, isMembersAdminOnly }: { isInfoAdminOnly?: boolean; isMembersAdminOnly?: boolean },
): GroupChangeBuilder {
  return ({ accessControl }) => {
    const attributes = getAccessRequired(isInfoAdminOnly);
    const members = getAccessRequired(isMembersAdminOnly);
    const actions: GroupActions = {
      modifyAttributesAccess: isInfoAdminOnly !== undefined && attributes !== accessControl.attributes
        ? { attributesAccess: attributes }
        : undefined,
      modifyMemberAccess: isMembersAdminOnly !== undefined && members !== accessControl.members
        ? { membersAccess: members }
        : undefined,
    };
    return actions.modifyAttributesAccess || actions.modifyMemberAccess ? actions : undefined;
  };
}

export function buildAnnouncementsOnlyChange(isAnnouncementsOnly: boolean): GroupChangeBuilder {
  return (state) => (Boolean(state.isAnnouncementsOnly) === isAnnouncementsOnly
    ? undefined
    : { modifyAnnouncementsOnly: { announcementsOnly: isAnnouncementsOnly } });
}

/**
 * Turns the group link on, with or without admin approval, or off. A link turned on for the first time or reset
 * gets a new password (Signal Desktop `buildNewGroupLinkChange` and `buildInviteLinkPasswordChange`).
 */
export function buildInviteLinkChange(
  { isEnabled, isApprovalRequired, shouldReset }: InviteLinkSettings,
): GroupChangeBuilder {
  return (state) => {
    const access = !isEnabled
      ? AccessControl_AccessRequired.UNSATISFIABLE
      : isApprovalRequired ? AccessControl_AccessRequired.ADMINISTRATOR : AccessControl_AccessRequired.ANY;
    const hasNewPassword = shouldReset || (isEnabled && !state.inviteLinkPassword);
    if (access === state.accessControl.addFromInviteLink && !hasNewPassword) return undefined;
    return {
      modifyAddFromInviteLinkAccess: access !== state.accessControl.addFromInviteLink
        ? { addFromInviteLinkAccess: access }
        : undefined,
      modifyInviteLinkPassword: hasNewPassword
        ? { inviteLinkPassword: getRandomBytes(INVITE_LINK_PASSWORD_LENGTH) }
        : undefined,
    };
  };
}

/** Approves a join request, or denies and bans the requester (Signal Desktop `approvePendingApprovalRequest`) */
export function buildJoinRequestChange(aci: string, isApproved: boolean): GroupChangeBuilder {
  return (state, context) => {
    if (!state.requestingMembers.some((member) => member.aci === aci)) return undefined;
    if (!isApproved) return buildRemoveMemberChange(aci, true)(state, context);
    return {
      promoteMembersPendingAdminApproval: [{
        userId: encryptGroupServiceId(context.secretParams, aci),
        role: Member_Role.DEFAULT,
      }],
    };
  };
}

export function buildUnbanChange(serviceId: string): GroupChangeBuilder {
  return (state, { secretParams }) => (state.bannedMembers.some((member) => member.serviceId === serviceId)
    ? { deleteMembersBanned: [{ deletedUserId: encryptGroupServiceId(secretParams, serviceId) }] }
    : undefined);
}

/** Builds one change from several, such as access levels with announcements-only; lists of actions add up */
export function combineGroupChanges(...builders: GroupChangeBuilder[]): GroupChangeBuilder {
  return async (state, context) => {
    const parts: GroupActions[] = [];
    for (const build of builders) {
      const actions = await build(state, context);
      if (actions) parts.push(actions);
    }
    if (!parts.length) return undefined;

    const combined: Record<string, unknown> = {};
    for (const part of parts) {
      for (const [key, value] of Object.entries(part)) {
        const previous = combined[key];
        combined[key] = Array.isArray(previous) && Array.isArray(value) ? [...previous, ...value] : value ?? previous;
      }
    }
    return combined;
  };
}

/** Group titles are limited in grapheme clusters, as Signal Android counts them */
export function checkGroupTitle(title: string) {
  if (countGraphemes(title) > GROUP_TITLE_MAX_GRAPHEMES) throw new GroupChangeRefusedError('titleTooLong');
}

export function checkGroupDescription(description: string) {
  if (countGraphemes(description) > GROUP_DESCRIPTION_MAX_GRAPHEMES) {
    throw new GroupChangeRefusedError('descriptionTooLong');
  }
}

function countGraphemes(text: string) {
  return [...new Intl.Segmenter().segment(text)].length;
}

function getAccessRequired(isAdminOnly?: boolean) {
  return isAdminOnly ? AccessControl_AccessRequired.ADMINISTRATOR : AccessControl_AccessRequired.MEMBER;
}

/**
 * Bans a user unless already banned, dropping the oldest bans over the group size limit
 * (Signal Desktop `_maybeBuildAddBannedMemberActions`)
 */
function buildBanActions(state: GroupState, secretParams: Uint8Array, selfAci: string, serviceId: string) {
  if (serviceId === selfAci || state.bannedMembers.some((member) => member.serviceId === serviceId)) return {};
  const oldest = [...state.bannedMembers]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(GROUP_SIZE_HARD_LIMIT - 1);
  return {
    addMembersBanned: [{ added: { userId: encryptGroupServiceId(secretParams, serviceId) } }],
    deleteMembersBanned: oldest.map((member) => ({
      deletedUserId: encryptGroupServiceId(secretParams, member.serviceId),
    })),
  } satisfies GroupActions;
}
