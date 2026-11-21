import { fromBinary } from '@bufbuild/protobuf';

import type ChatConnection from '../chat/ChatConnection';
import type { HttpRequest } from '../net/http';
import type {
  AccessControl, Group, Member, Member_Role,
} from '../proto/generated/Groups_pb';
import type { AccountRecord } from '../store/SignalStore';

import { SIGNAL_CDN_HOSTS, SIGNAL_STORAGE_HOST, SIGNAL_ZKGROUP_SERVER_PUBLIC_PARAMS } from '../config';
import { bufferFromBase64, bufferToBase64, bufferToHex } from '../../../util/encoding/buffer';
import { getServerTime } from '../../../util/serverTime';
import { encodeUtf8, getRandomBytes } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { toPniServiceId } from '../serviceId';
import { wasm } from '../wasm';
import {
  decryptGroupAttribute, decryptGroupProfileKey, decryptGroupServiceId, decryptGroupText,
} from './groupCipher';

import { AccessControl_AccessRequired, GroupResponseSchema } from '../proto/generated/Groups_pb';

export type GroupMember = {
  aci: string;
  role?: Member_Role;
  profileKey?: Uint8Array;
  joinedAtRevision?: number;
  labelEmoji?: string;
  label?: string;
};

export type GroupAccessControl = {
  attributes: AccessControl_AccessRequired;
  members: AccessControl_AccessRequired;
  addFromInviteLink: AccessControl_AccessRequired;
  memberLabel: AccessControl_AccessRequired;
};

/** The decrypted state of a group v2 at one revision; it is stored with the group's conversation */
export type GroupState = {
  revision: number;
  title?: string;
  description?: string;
  avatarUrl?: string;
  expireTimer?: number;
  accessControl: GroupAccessControl;
  members: GroupMember[];
  // Invited members, by ACI or PNI, who have not accepted yet
  pendingMembers: { serviceId: string; role?: Member_Role; addedBy?: string; timestamp?: number }[];
  // People who asked to join through the group link and wait for an admin
  requestingMembers: { aci: string; profileKey?: Uint8Array; timestamp?: number }[];
  bannedMembers: { serviceId: string; timestamp?: number }[];
  inviteLinkPassword?: Uint8Array;
  isAnnouncementsOnly?: boolean;
  isTerminated?: boolean;
};

export type FetchedGroup = {
  state: GroupState;
  // `GroupSendEndorsementsResponse` for full members; see `saveGroupSendEndorsements`
  sendEndorsementsResponse?: Uint8Array;
};

type GroupRequest = Pick<HttpRequest, 'method' | 'path' | 'body' | 'headers'> & { contentType?: string };

type GroupCredentialsResponse = {
  pni?: string;
  credentials: { credential: string; redemptionTime: number }[];
};

const HTTP_OK = 200;
const HTTP_MULTIPLE_CHOICES = 300;
const PROTOBUF_CONTENT_TYPE = 'application/x-protobuf';
const DAY_SECONDS = 24 * 60 * 60;
const CREDENTIAL_DAYS = 7;
const RANDOMNESS_LENGTH = 32;
const AVATAR_CDN_NUMBER = 0;

let serverPublicParams: wasm.ServerPublicParams | undefined;
// Credentials of the account that fetched them, which a device linked anew in the same session does not reuse
let cachedCredentials: { aci: string; day: number; response: GroupCredentialsResponse } | undefined;

/** A storage service group request that failed; 409 means the group changed since the state the request used */
export class GroupRequestError extends Error {
  constructor(readonly status: number, path: string) {
    super(`Group request ${path} failed with HTTP ${status}`);
  }
}

/** Fetches and decrypts the current state of a group v2 from its master key, with its send endorsements */
export async function fetchGroup(
  account: AccountRecord, connection: ChatConnection, masterKey: Uint8Array,
): Promise<FetchedGroup> {
  const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
  const { body } = await sendGroupRequest(account, connection, secretParams, { method: 'GET', path: '/v2/groups/' });
  const { group, groupSendEndorsementsResponse } = fromBinary(GroupResponseSchema, body);
  if (!group) throw new Error('Group response has no group');
  return {
    state: decryptGroupState(secretParams, group),
    sendEndorsementsResponse: groupSendEndorsementsResponse.length ? groupSendEndorsementsResponse : undefined,
  };
}

/**
 * Sends a request to the storage service group API with the group authorization of `secretParams`;
 * throws `GroupRequestError` on other statuses than 2xx
 */
export async function sendGroupRequest(
  account: AccountRecord,
  connection: ChatConnection,
  secretParams: Uint8Array,
  {
    method, path, body, contentType, headers: extraHeaders,
  }: GroupRequest,
) {
  const headers: Record<string, string> = {
    ...extraHeaders,
    Authorization: `Basic ${await getGroupAuthorization(account, connection, secretParams)}`,
  };
  if (body) headers['Content-Type'] = contentType ?? PROTOBUF_CONTENT_TYPE;
  const response = await sendHttpRequest(SIGNAL_STORAGE_HOST, {
    method, path, headers, body,
  });
  if (response.status < HTTP_OK || response.status >= HTTP_MULTIPLE_CHOICES) {
    throw new GroupRequestError(response.status, path);
  }
  return response;
}

/** Decrypts a group's state with its secret params (`GroupSecretParams_DeriveFromMasterKey`) */
export function decryptGroupState(secretParams: Uint8Array, group: Group): GroupState {
  const decryptServiceId = (ciphertext: Uint8Array) => decryptGroupServiceId(secretParams, ciphertext);
  const title = decryptGroupAttribute(secretParams, group.title);
  const description = decryptGroupAttribute(secretParams, group.description);
  const timer = decryptGroupAttribute(secretParams, group.disappearingMessagesTimer);

  return {
    revision: group.version,
    title: title?.case === 'title' ? title.value : undefined,
    description: description?.case === 'descriptionText' ? description.value : undefined,
    avatarUrl: group.avatarUrl || undefined,
    expireTimer: timer?.case === 'disappearingMessagesDuration' ? timer.value : undefined,
    accessControl: buildAccessControl(group.accessControl),
    members: group.members.map((member) => decryptMember(secretParams, member)),
    pendingMembers: group.membersPendingProfileKey.map(({ member, addedByUserId, timestamp }) => ({
      serviceId: decryptServiceId(member!.userId),
      role: member!.role,
      addedBy: addedByUserId.length ? decryptServiceId(addedByUserId) : undefined,
      timestamp: Number(timestamp),
    })),
    requestingMembers: group.membersPendingAdminApproval.map(({ userId, profileKey, timestamp }) => {
      const aci = decryptServiceId(userId);
      return { aci, profileKey: decryptGroupProfileKey(secretParams, profileKey, aci), timestamp: Number(timestamp) };
    }),
    bannedMembers: group.membersBanned.map(({ userId, timestamp }) => ({
      serviceId: decryptServiceId(userId),
      timestamp: Number(timestamp),
    })),
    inviteLinkPassword: group.inviteLinkPassword.length ? group.inviteLinkPassword : undefined,
    isAnnouncementsOnly: group.announcementsOnly,
    isTerminated: group.terminated,
  };
}

/** Decrypts a full member, as in a group state or an `AddMemberAction` from the server */
export function decryptMember(secretParams: Uint8Array, member: Member): GroupMember {
  const aci = decryptGroupServiceId(secretParams, member.userId);
  return {
    aci,
    role: member.role,
    profileKey: decryptGroupProfileKey(secretParams, member.profileKey, aci),
    joinedAtRevision: member.joinedAtVersion,
    labelEmoji: decryptGroupText(secretParams, member.labelEmoji),
    label: decryptGroupText(secretParams, member.labelString),
  };
}

/** Access levels with Signal's defaults for unset fields (Signal Desktop `applyGroupChange`) */
export function buildAccessControl(accessControl?: AccessControl): GroupAccessControl {
  return {
    attributes: accessControl?.attributes || AccessControl_AccessRequired.MEMBER,
    members: accessControl?.members || AccessControl_AccessRequired.MEMBER,
    addFromInviteLink: accessControl?.addFromInviteLink || AccessControl_AccessRequired.UNSATISFIABLE,
    memberLabel: accessControl?.memberLabel || AccessControl_AccessRequired.MEMBER,
  };
}

/**
 * Downloads a group avatar by the key in `GroupState.avatarUrl` and decrypts it with the group's secret params
 * (Signal Desktop `ts/groups.preload.ts`, `decryptGroupAvatar`)
 */
export async function downloadGroupAvatar(avatarUrl: string, masterKey: Uint8Array) {
  const response = await sendHttpRequest(SIGNAL_CDN_HOSTS[AVATAR_CDN_NUMBER], {
    method: 'GET',
    path: `/${encodeURIComponent(avatarUrl)}`,
  });
  if (response.status !== HTTP_OK) throw new Error(`Group avatar download failed with HTTP ${response.status}`);

  const content = decryptGroupAttribute(wasm.GroupSecretParams_DeriveFromMasterKey(masterKey), response.body);
  if (content?.case !== 'avatar') throw new Error('Group avatar blob has no avatar');
  return content.value;
}

export function getServerPublicParams() {
  serverPublicParams ??= wasm.ServerPublicParams_Deserialize(bufferFromBase64(SIGNAL_ZKGROUP_SERVER_PUBLIC_PARAMS));
  return serverPublicParams;
}

/**
 * Builds the storage service group authorization: hex group public params and a zero-knowledge
 * presentation of today's auth credential, separated by a colon and base64-encoded
 */
async function getGroupAuthorization(account: AccountRecord, connection: ChatConnection, secretParams: Uint8Array) {
  const publicParams = wasm.GroupSecretParams_GetPublicParams(secretParams);
  const params = getServerPublicParams();
  const today = Math.floor(getServerTime() / DAY_SECONDS) * DAY_SECONDS;
  const { credentials } = await getGroupCredentials(connection, account.aci, today);
  const todayCredential = credentials.find(({ redemptionTime }) => redemptionTime === today);
  if (!todayCredential) throw new Error('No group auth credential for today');

  const aci = wasm.ServiceId_ParseFromServiceIdString(account.aci);
  const response = bufferFromBase64(todayCredential.credential);
  let credential: Uint8Array;
  if (account.pni) {
    const pni = wasm.ServiceId_ParseFromServiceIdString(toPniServiceId(account.pni));
    credential = wasm.ServerPublicParams_ReceiveAuthCredentialWithPniAsServiceId(
      params, aci, pni, todayCredential.redemptionTime, response,
    );
  } else {
    // Accounts without a phone number
    if (!account.authCredentialSalt) throw new Error('Auth credential salt is missing');
    credential = wasm.ServerPublicParams_ReceiveAuthCredentialZkcWithoutPni(
      params, aci, account.authCredentialSalt, todayCredential.redemptionTime, response,
    );
  }
  const presentation = wasm.ServerPublicParams_CreateAuthCredentialWithPniPresentationDeterministic(
    params, getRandomBytes(RANDOMNESS_LENGTH), secretParams, credential,
  );

  return bufferToBase64(encodeUtf8(`${bufferToHex(publicParams)}:${bufferToHex(presentation)}`));
}

async function getGroupCredentials(connection: ChatConnection, aci: string, today: number) {
  if (cachedCredentials?.aci === aci && cachedCredentials.day === today) return cachedCredentials.response;

  const end = today + CREDENTIAL_DAYS * DAY_SECONDS;
  const { status, json } = await connection.sendJsonRequest<GroupCredentialsResponse>(
    'GET',
    `/v1/certificate/auth/group?redemptionStartSeconds=${today}&redemptionEndSeconds=${end}`
    + '&v101=true&zkcCredential=true',
  );
  if (status !== HTTP_OK || !json) throw new Error(`Group credentials request failed with HTTP ${status}`);

  cachedCredentials = { aci, day: today, response: json };
  return json;
}
