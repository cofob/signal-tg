import type { DecryptedGroupChange } from './groupChange';

import { AccessControl_AccessRequired, Member_Role } from '../proto/generated/Groups_pb';

/** What a group notice in the history says; who made the change is the notice's `actorAci` */
export type GroupUpdate =
  | { type: 'create' }
  | { type: 'title'; title?: string }
  | { type: 'avatar'; isRemoved?: boolean }
  | { type: 'description'; isRemoved?: boolean }
  // Members the actor added; an actor that adds itself joined, as by accepting an invitation
  | { type: 'membersAdded'; acis: string[]; isFromInviteLink?: boolean }
  // An actor that removes itself left
  | { type: 'memberRemoved'; aci: string }
  | { type: 'invited'; count: number }
  // The actor asked to join through the group link
  | { type: 'joinRequested' }
  | { type: 'joinApproved'; aci: string }
  | { type: 'adminChanged'; aci: string; isAdmin: boolean }
  | { type: 'access'; target: 'info' | 'members'; isAdminOnly: boolean }
  | { type: 'inviteLink'; state: 'on' | 'onWithApproval' | 'off' | 'reset' }
  | { type: 'announcementsOnly'; isEnabled: boolean };

export type GroupNotice = { actorAci?: string; update: GroupUpdate };

const ADMIN_ONLY = AccessControl_AccessRequired.ADMINISTRATOR;

/**
 * The notices that a change adds to the history, in the order of Signal Desktop `extractDiffs`. Changes that
 * are not shown, such as new profile keys, member labels and bans, add none; the disappearing timer has its
 * own notice kind.
 */
export function buildGroupNotices(change: DecryptedGroupChange): GroupNotice[] {
  const actorAci = change.sourceServiceId;
  const updates: GroupNotice[] = [];
  const add = (update: GroupUpdate, actor = actorAci) => updates.push({ actorAci: actor, update });

  if (change.attributesAccess) {
    add({ type: 'access', target: 'info', isAdminOnly: change.attributesAccess === ADMIN_ONLY });
  }
  if (change.membersAccess) {
    add({ type: 'access', target: 'members', isAdminOnly: change.membersAccess === ADMIN_ONLY });
  }
  const linkState = getInviteLinkState(change);
  if (linkState) add({ type: 'inviteLink', state: linkState });
  if (change.avatarUrl) add({ type: 'avatar', isRemoved: !change.avatarUrl.value || undefined });
  if (change.title) add({ type: 'title', title: change.title.value });
  if (change.description) add({ type: 'description', isRemoved: !change.description.value || undefined });
  if (change.isAnnouncementsOnly !== undefined) {
    add({ type: 'announcementsOnly', isEnabled: change.isAnnouncementsOnly });
  }

  const added = change.addMembers.filter(({ aci }) => aci !== actorAci);
  const joined = change.addMembers.find(({ aci }) => aci === actorAci);
  if (added.length) add({ type: 'membersAdded', acis: added.map(({ aci }) => aci) });
  if (joined) add({ type: 'membersAdded', acis: [joined.aci], isFromInviteLink: joined.isFromInviteLink });
  for (const { aci } of change.promotePendingMembers) add({ type: 'membersAdded', acis: [aci] }, aci);
  for (const { aci } of change.promoteRequestingMembers) add({ type: 'joinApproved', aci });
  for (const { aci } of change.addRequestingMembers) add({ type: 'joinRequested' }, aci);
  change.deleteMembers.forEach((aci) => add({ type: 'memberRemoved', aci }));
  if (change.addPendingMembers.length) add({ type: 'invited', count: change.addPendingMembers.length });
  for (const { aci, role } of change.modifyMemberRoles) {
    add({ type: 'adminChanged', aci, isAdmin: role === Member_Role.ADMINISTRATOR });
  }
  return updates;
}

function getInviteLinkState(change: DecryptedGroupChange) {
  switch (change.addFromInviteLinkAccess) {
    case AccessControl_AccessRequired.ANY:
      return 'on';
    case AccessControl_AccessRequired.ADMINISTRATOR:
      return 'onWithApproval';
    case AccessControl_AccessRequired.UNSATISFIABLE:
      return 'off';
    default:
      return change.inviteLinkPassword?.value ? 'reset' : undefined;
  }
}
