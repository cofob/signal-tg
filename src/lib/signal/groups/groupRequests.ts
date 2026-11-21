import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import type ChatConnection from '../chat/ChatConnection';
import type { AccountRecord } from '../store/SignalStore';
import type { GroupActions } from './buildGroupChange';
import type { FetchedGroup } from './fetchGroup';

import { SIGNAL_CDN_HOSTS } from '../config';
import { bufferToBase64Url } from '../../../util/encoding/base64';
import { bufferToHex, concat } from '../../../util/encoding/buffer';
import { getRandomBytes } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { wasm } from '../wasm';
import { decryptGroupState, sendGroupRequest } from './fetchGroup';
import { decryptGroupAttribute, encryptGroupAttribute, encryptGroupServiceId } from './groupCipher';
import { createProfileKeyCredentialPresentation } from './profileKeyCredentials';

import {
  AccessControl_AccessRequired,
  AvatarUploadAttributesSchema,
  GroupChange_ActionsSchema,
  GroupChangeResponseSchema,
  GroupJoinInfoSchema,
  GroupResponseSchema,
  GroupSchema,
  Member_Role,
} from '../proto/generated/Groups_pb';

export type NewGroup = {
  title: string;
  avatarUrl?: string;
  expireTimer?: number;
  // Expiring profile key credentials of the members other than us
  memberCredentials: Uint8Array[];
  // Users without a credential, who are invited
  invitedAcis: string[];
};

export type GroupJoinInfo = {
  revision: number;
  title?: string;
  description?: string;
  avatarUrl?: string;
  memberCount: number;
  isApprovalRequired: boolean;
  // We already asked to join and wait for an admin
  isPendingApproval: boolean;
};

const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 299;
const AVATAR_CDN_NUMBER = 0;
const MASTER_KEY_RANDOMNESS_LENGTH = 32;
const BOUNDARY_RANDOM_LENGTH = 16;

const textEncoder = new TextEncoder();

/**
 * Submits change actions for the next revision (`PATCH /v2/groups/`, Signal Desktop `modifyGroup`) and returns the
 * signed change with the send endorsements for the members after it. `inviteLinkPassword` lets a non-member join.
 */
export async function submitGroupChange(
  account: AccountRecord,
  connection: ChatConnection,
  secretParams: Uint8Array,
  actions: GroupActions,
  inviteLinkPassword?: Uint8Array,
) {
  const query = inviteLinkPassword ? `?inviteLinkPassword=${bufferToBase64Url(inviteLinkPassword)}` : '';
  const { body } = await sendGroupRequest(account, connection, secretParams, {
    method: 'PATCH',
    path: `/v2/groups/${query}`,
    body: toBinary(GroupChange_ActionsSchema, create(GroupChange_ActionsSchema, actions)),
  });
  const { groupChange, groupSendEndorsementsResponse } = fromBinary(GroupChangeResponseSchema, body);
  if (!groupChange) throw new Error('Group change response has no change');
  return {
    groupChange,
    sendEndorsementsResponse: groupSendEndorsementsResponse.length ? groupSendEndorsementsResponse : undefined,
  };
}

/**
 * Creates a group with a new master key (`PUT /v2/groups/`, Signal Desktop `createGroupV2`): we are its admin,
 * members join at revision 0, and everyone may edit it and add members, while the group link is off
 */
export async function createGroupOnServer(
  account: AccountRecord, connection: ChatConnection, group: NewGroup, selfCredential: Uint8Array,
): Promise<FetchedGroup & { masterKey: Uint8Array }> {
  const secretParams = wasm.GroupSecretParams_GenerateDeterministic(getRandomBytes(MASTER_KEY_RANDOMNESS_LENGTH));
  const masterKey = wasm.GroupSecretParams_GetMasterKey(secretParams);
  const toMember = (credential: Uint8Array, role: Member_Role) => ({
    role, presentation: createProfileKeyCredentialPresentation(secretParams, credential),
  });

  const { body } = await sendGroupRequest(account, connection, secretParams, {
    method: 'PUT',
    path: '/v2/groups/',
    body: toBinary(GroupSchema, create(GroupSchema, {
      publicKey: wasm.GroupSecretParams_GetPublicParams(secretParams),
      version: 0,
      title: encryptGroupAttribute(secretParams, { case: 'title', value: group.title }),
      avatarUrl: group.avatarUrl,
      disappearingMessagesTimer: group.expireTimer
        ? encryptGroupAttribute(secretParams, { case: 'disappearingMessagesDuration', value: group.expireTimer })
        : undefined,
      accessControl: {
        attributes: AccessControl_AccessRequired.MEMBER,
        members: AccessControl_AccessRequired.MEMBER,
        addFromInviteLink: AccessControl_AccessRequired.UNSATISFIABLE,
        memberLabel: AccessControl_AccessRequired.MEMBER,
      },
      members: [
        toMember(selfCredential, Member_Role.ADMINISTRATOR),
        ...group.memberCredentials.map((credential) => toMember(credential, Member_Role.DEFAULT)),
      ],
      membersPendingProfileKey: group.invitedAcis.map((aci) => ({
        member: { userId: encryptGroupServiceId(secretParams, aci), role: Member_Role.DEFAULT },
        addedByUserId: encryptGroupServiceId(secretParams, account.aci),
        timestamp: BigInt(Date.now()),
      })),
    })),
  });

  const { group: created, groupSendEndorsementsResponse } = fromBinary(GroupResponseSchema, body);
  if (!created) throw new Error('Group creation response has no group');
  return {
    masterKey,
    state: decryptGroupState(secretParams, created),
    sendEndorsementsResponse: groupSendEndorsementsResponse.length ? groupSendEndorsementsResponse : undefined,
  };
}

/**
 * Encrypts an avatar and uploads it to CDN 0 with the form from `GET /v2/groups/avatar/form`; returns the key that
 * `ModifyAvatarAction` takes (Signal Desktop `uploadGroupAvatar`)
 */
export async function uploadGroupAvatar(
  account: AccountRecord, connection: ChatConnection, secretParams: Uint8Array, avatar: Uint8Array,
) {
  const { body } = await sendGroupRequest(account, connection, secretParams, {
    method: 'GET',
    path: '/v2/groups/avatar/form',
  });
  const form = fromBinary(AvatarUploadAttributesSchema, body);
  const encrypted = encryptGroupAttribute(secretParams, { case: 'avatar', value: avatar });

  const boundary = `----------------${bufferToHex(getRandomBytes(BOUNDARY_RANDOM_LENGTH))}`;
  const fields = [
    ['key', form.key],
    ['x-amz-credential', form.credential],
    ['acl', form.acl],
    ['x-amz-algorithm', form.algorithm],
    ['x-amz-date', form.date],
    ['policy', form.policy],
    ['x-amz-signature', form.signature],
    ['Content-Type', 'application/octet-stream'],
  ];
  const head = [
    ...fields.map(([name, value]) => (
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    )),
    `--${boundary}\r\nContent-Disposition: form-data; name="file"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  ].join('');
  const tail = `\r\n--${boundary}--\r\n`;

  const response = await sendHttpRequest(SIGNAL_CDN_HOSTS[AVATAR_CDN_NUMBER], {
    method: 'POST',
    path: '/',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: concat(textEncoder.encode(head), encrypted, textEncoder.encode(tail)),
  });
  if (response.status < HTTP_SUCCESS_MIN || response.status > HTTP_SUCCESS_MAX) {
    throw new Error(`Group avatar upload failed with HTTP ${response.status}`);
  }
  return form.key;
}

/**
 * What a group link shows before joining (`GET /v2/groups/join/{password}`, Signal Desktop `getPreJoinGroupInfo`).
 * The server answers 403 when the link was reset or turned off, or we are banned.
 */
export async function fetchGroupJoinInfo(
  account: AccountRecord, connection: ChatConnection, secretParams: Uint8Array, inviteLinkPassword: Uint8Array,
): Promise<GroupJoinInfo> {
  const { body } = await sendGroupRequest(account, connection, secretParams, {
    method: 'GET',
    path: `/v2/groups/join/${bufferToBase64Url(inviteLinkPassword)}`,
  });
  const info = fromBinary(GroupJoinInfoSchema, body);
  const title = decryptGroupAttribute(secretParams, info.title);
  const description = decryptGroupAttribute(secretParams, info.description);
  return {
    revision: info.version,
    title: title?.case === 'title' ? title.value.trim() : undefined,
    description: description?.case === 'descriptionText' ? description.value.trim() : undefined,
    avatarUrl: info.avatar || undefined,
    memberCount: info.memberCount,
    isApprovalRequired: info.addFromInviteLink === AccessControl_AccessRequired.ADMINISTRATOR,
    isPendingApproval: info.pendingAdminApproval,
  };
}
