import { fromBinary } from '@bufbuild/protobuf';

import type {
  AccessControl_AccessRequired, GroupChange, GroupChange_Actions,
} from '../proto/generated/Groups_pb';
import type { GroupMember, GroupState } from './fetchGroup';

import { bufferToBase64 } from '../../../util/encoding/buffer';
import { wasm } from '../wasm';
import { decryptMember, getServerPublicParams } from './fetchGroup';
import {
  decryptGroupAttribute, decryptGroupProfileKey, decryptGroupServiceId, decryptGroupText,
} from './groupCipher';

import { GroupChange_ActionsSchema, Member_Role } from '../proto/generated/Groups_pb';

type ProfileKeyMember = { aci: string; profileKey?: Uint8Array };

// A field that a change sets, possibly to nothing
type FieldChange<T> = { value?: T };

/** The actions of a group change, decrypted; fields absent here are left as they are */
export type DecryptedGroupChange = {
  revision: number;
  // Who made the change; changes of the server, such as expired invitations, have none
  sourceServiceId?: string;
  addMembers: (GroupMember & { isFromInviteLink?: boolean })[];
  deleteMembers: string[];
  modifyMemberRoles: { aci: string; role: Member_Role }[];
  modifyMemberLabels: { aci: string; labelEmoji?: string; label?: string }[];
  modifyMemberProfileKeys: ProfileKeyMember[];
  addPendingMembers: GroupState['pendingMembers'];
  deletePendingMembers: string[];
  promotePendingMembers: (ProfileKeyMember & { pni?: string })[];
  addRequestingMembers: GroupState['requestingMembers'];
  deleteRequestingMembers: string[];
  promoteRequestingMembers: { aci: string; role: Member_Role }[];
  addBannedMembers: GroupState['bannedMembers'];
  deleteBannedMembers: string[];
  title?: FieldChange<string>;
  description?: FieldChange<string>;
  avatarUrl?: FieldChange<string>;
  expireTimer?: FieldChange<number>;
  attributesAccess?: AccessControl_AccessRequired;
  membersAccess?: AccessControl_AccessRequired;
  addFromInviteLinkAccess?: AccessControl_AccessRequired;
  memberLabelAccess?: AccessControl_AccessRequired;
  inviteLinkPassword?: FieldChange<Uint8Array>;
  isAnnouncementsOnly?: boolean;
  isTerminated?: boolean;
};

// Signal Desktop `ts/groups.preload.ts`: changes of later epochs carry actions this client cannot apply
export const SUPPORTED_CHANGE_EPOCH = 7;

/**
 * Returns the actions of a group change that another member sent, after checking the server's signature and
 * that the change belongs to the group, or `undefined` when it cannot be applied (Signal Desktop `getGroupUpdates`)
 */
export function verifyGroupChange(groupChange: GroupChange, groupId: string) {
  if (groupChange.changeEpoch > SUPPORTED_CHANGE_EPOCH || !groupChange.actions.length) return undefined;
  try {
    wasm.ServerPublicParams_VerifySignature(getServerPublicParams(), groupChange.actions, groupChange.serverSignature);
  } catch {
    return undefined;
  }
  const actions = fromBinary(GroupChange_ActionsSchema, groupChange.actions);
  return bufferToBase64(actions.groupId) === groupId ? actions : undefined;
}

/** Decrypts change actions as the server returns and signs them (Signal Desktop `decryptGroupChange`) */
export function decryptGroupChange(secretParams: Uint8Array, actions: GroupChange_Actions): DecryptedGroupChange {
  const decryptServiceId = (ciphertext: Uint8Array) => decryptGroupServiceId(secretParams, ciphertext);
  const decryptProfileKeyMember = (userId: Uint8Array, profileKey: Uint8Array) => {
    const aci = decryptServiceId(userId);
    return { aci, profileKey: decryptGroupProfileKey(secretParams, profileKey, aci) };
  };
  const title = actions.modifyTitle && decryptGroupAttribute(secretParams, actions.modifyTitle.title);
  const description = actions.modifyDescription
    && decryptGroupAttribute(secretParams, actions.modifyDescription.description);
  const timer = actions.modifyDisappearingMessageTimer
    && decryptGroupAttribute(secretParams, actions.modifyDisappearingMessageTimer.timer);

  return {
    revision: actions.version,
    sourceServiceId: actions.sourceUserId.length ? decryptServiceId(actions.sourceUserId) : undefined,
    addMembers: actions.addMembers.map(({ added, joinFromInviteLink }) => ({
      ...decryptMember(secretParams, added!),
      isFromInviteLink: joinFromInviteLink || undefined,
    })),
    deleteMembers: actions.deleteMembers.map(({ deletedUserId }) => decryptServiceId(deletedUserId)),
    modifyMemberRoles: actions.modifyMemberRoles.map(({ userId, role }) => ({ aci: decryptServiceId(userId), role })),
    modifyMemberLabels: actions.modifyMemberLabels.map(({ userId, labelEmoji, labelString }) => ({
      aci: decryptServiceId(userId),
      labelEmoji: decryptGroupText(secretParams, labelEmoji),
      label: decryptGroupText(secretParams, labelString),
    })),
    modifyMemberProfileKeys: actions.modifyMemberProfileKeys.map(({ userId, profileKey }) => (
      decryptProfileKeyMember(userId, profileKey)
    )),
    addPendingMembers: actions.addMembersPendingProfileKey.map(({ added }) => ({
      serviceId: decryptServiceId(added!.member!.userId),
      role: added!.member!.role,
      addedBy: added!.addedByUserId.length ? decryptServiceId(added!.addedByUserId) : undefined,
      timestamp: Number(added!.timestamp),
    })),
    deletePendingMembers: actions.deleteMembersPendingProfileKey.map(({ deletedUserId }) => (
      decryptServiceId(deletedUserId)
    )),
    promotePendingMembers: [
      ...actions.promoteMembersPendingProfileKey.map(({ userId, profileKey }) => (
        decryptProfileKeyMember(userId, profileKey)
      )),
      ...actions.promoteMembersPendingPniAciProfileKey.map(({ userId, pni, profileKey }) => ({
        ...decryptProfileKeyMember(userId, profileKey),
        pni: decryptServiceId(pni),
      })),
    ],
    addRequestingMembers: actions.addMembersPendingAdminApproval.map(({ added }) => ({
      ...decryptProfileKeyMember(added!.userId, added!.profileKey),
      timestamp: Number(added!.timestamp),
    })),
    deleteRequestingMembers: actions.deleteMembersPendingAdminApproval.map(({ deletedUserId }) => (
      decryptServiceId(deletedUserId)
    )),
    promoteRequestingMembers: actions.promoteMembersPendingAdminApproval.map(({ userId, role }) => ({
      aci: decryptServiceId(userId), role,
    })),
    addBannedMembers: actions.addMembersBanned.map(({ added }) => ({
      serviceId: decryptServiceId(added!.userId),
      timestamp: Number(added!.timestamp),
    })),
    deleteBannedMembers: actions.deleteMembersBanned.map(({ deletedUserId }) => decryptServiceId(deletedUserId)),
    title: actions.modifyTitle && { value: title?.case === 'title' ? title.value.trim() : undefined },
    description: actions.modifyDescription && {
      value: description?.case === 'descriptionText' ? description.value : undefined,
    },
    avatarUrl: actions.modifyAvatar && { value: actions.modifyAvatar.avatar || undefined },
    expireTimer: actions.modifyDisappearingMessageTimer && {
      value: timer?.case === 'disappearingMessagesDuration' ? timer.value || undefined : undefined,
    },
    attributesAccess: actions.modifyAttributesAccess?.attributesAccess,
    membersAccess: actions.modifyMemberAccess?.membersAccess,
    addFromInviteLinkAccess: actions.modifyAddFromInviteLinkAccess?.addFromInviteLinkAccess,
    memberLabelAccess: actions.modifyMemberLabelAccess?.memberLabelAccess,
    inviteLinkPassword: actions.modifyInviteLinkPassword && {
      value: actions.modifyInviteLinkPassword.inviteLinkPassword.length
        ? actions.modifyInviteLinkPassword.inviteLinkPassword
        : undefined,
    },
    isAnnouncementsOnly: actions.modifyAnnouncementsOnly?.announcementsOnly,
    isTerminated: actions.terminateGroup ? true : undefined,
  };
}

/**
 * Applies a decrypted change to the state of the previous revision (Signal Desktop `applyGroupChange`).
 * Actions on members already in the target list, or missing from the list they leave, are skipped.
 */
export function applyGroupChange(state: GroupState, change: DecryptedGroupChange): GroupState {
  const { revision } = change;
  const members = new Map(state.members.map((member) => [member.aci, member]));
  const pending = new Map(state.pendingMembers.map((member) => [member.serviceId, member]));
  const requesting = new Map(state.requestingMembers.map((member) => [member.aci, member]));
  const banned = new Map(state.bannedMembers.map((member) => [member.serviceId, member]));

  for (const { isFromInviteLink, ...added } of change.addMembers) {
    if (members.has(added.aci)) continue;
    members.set(added.aci, { ...added, role: added.role || Member_Role.DEFAULT, joinedAtRevision: revision });
    pending.delete(added.aci);
    requesting.delete(added.aci);
  }
  change.deleteMembers.forEach((aci) => members.delete(aci));
  for (const { aci, role } of change.modifyMemberRoles) {
    const member = members.get(aci);
    if (member) members.set(aci, { ...member, role });
  }
  for (const { aci, labelEmoji, label } of change.modifyMemberLabels) {
    const member = members.get(aci);
    if (member) members.set(aci, { ...member, labelEmoji, label });
  }
  for (const { aci, profileKey } of change.modifyMemberProfileKeys) {
    const member = members.get(aci);
    if (member) members.set(aci, { ...member, profileKey });
  }
  for (const added of change.addPendingMembers) {
    if (!members.has(added.serviceId) && !pending.has(added.serviceId)) pending.set(added.serviceId, added);
  }
  change.deletePendingMembers.forEach((serviceId) => pending.delete(serviceId));
  for (const { aci, pni, profileKey } of change.promotePendingMembers) {
    const invited = pending.get(pni ?? aci);
    if (!invited) continue;
    pending.delete(pni ?? aci);
    if (!members.has(aci)) {
      members.set(aci, {
        aci, profileKey, role: invited.role || Member_Role.DEFAULT, joinedAtRevision: revision,
      });
    }
  }
  for (const added of change.addRequestingMembers) {
    if (!members.has(added.aci) && !pending.has(added.aci)) requesting.set(added.aci, added);
  }
  change.deleteRequestingMembers.forEach((aci) => requesting.delete(aci));
  for (const { aci, role } of change.promoteRequestingMembers) {
    const requester = requesting.get(aci);
    if (!requester) continue;
    requesting.delete(aci);
    if (!members.has(aci)) {
      members.set(aci, {
        aci, profileKey: requester.profileKey, role, joinedAtRevision: revision,
      });
    }
  }
  change.addBannedMembers.forEach((added) => banned.set(added.serviceId, added));
  change.deleteBannedMembers.forEach((serviceId) => banned.delete(serviceId));

  const { accessControl } = state;
  return {
    ...state,
    revision,
    title: change.title ? change.title.value : state.title,
    description: change.description ? change.description.value : state.description,
    avatarUrl: change.avatarUrl ? change.avatarUrl.value : state.avatarUrl,
    expireTimer: change.expireTimer ? change.expireTimer.value : state.expireTimer,
    accessControl: {
      attributes: change.attributesAccess || accessControl.attributes,
      members: change.membersAccess || accessControl.members,
      addFromInviteLink: change.addFromInviteLinkAccess || accessControl.addFromInviteLink,
      memberLabel: change.memberLabelAccess || accessControl.memberLabel,
    },
    members: [...members.values()],
    pendingMembers: [...pending.values()],
    requestingMembers: [...requesting.values()],
    bannedMembers: [...banned.values()],
    inviteLinkPassword: change.inviteLinkPassword ? change.inviteLinkPassword.value : state.inviteLinkPassword,
    isAnnouncementsOnly: change.isAnnouncementsOnly ?? state.isAnnouncementsOnly,
    isTerminated: change.isTerminated ?? state.isTerminated,
  };
}

/** The ACIs and profile keys that a change brings, which sealed sender to those members needs */
export function getChangeProfileKeys(change: DecryptedGroupChange) {
  return [
    ...change.addMembers,
    ...change.modifyMemberProfileKeys,
    ...change.promotePendingMembers,
    ...change.addRequestingMembers,
  ].filter((member): member is ProfileKeyMember & { profileKey: Uint8Array } => Boolean(member.profileKey));
}
