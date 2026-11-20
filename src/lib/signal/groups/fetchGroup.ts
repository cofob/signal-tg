import type ChatConnection from '../chat/ChatConnection';
import type { AccessControl, Group, Member_Role } from '../proto/generated/Groups';
import type { AccountRecord } from '../store/SignalStore';

import { SIGNAL_STORAGE_HOST, SIGNAL_ZKGROUP_SERVER_PUBLIC_PARAMS } from '../config';
import { bufferFromBase64, bufferToBase64, bufferToHex } from '../../../util/encoding/buffer';
import { encodeUtf8, getRandomBytes } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { toPniServiceId } from '../serviceId';
import { wasm } from '../wasm';

import { GroupAttributeBlob, GroupResponse } from '../proto/generated/Groups';

export type GroupMember = {
  aci: string;
  role?: Member_Role;
  profileKey?: Uint8Array;
  joinedAtRevision?: number;
  labelEmoji?: string;
  label?: string;
};

export type GroupState = {
  groupId: string;
  revision: number;
  title?: string;
  description?: string;
  avatarUrl?: string;
  expireTimer?: number;
  accessControl?: AccessControl;
  members: GroupMember[];
  pendingMembers: { serviceId: string; addedBy?: string; timestamp?: number }[];
  requestingMembers: { aci: string; profileKey?: Uint8Array; timestamp?: number }[];
  bannedMembers: { serviceId: string; timestamp?: number }[];
  inviteLinkPassword?: Uint8Array;
  isAnnouncementsOnly?: boolean;
  isTerminated?: boolean;
};

type GroupCredentialsResponse = {
  pni?: string;
  credentials: { credential: string; redemptionTime: number }[];
};

const HTTP_OK = 200;
const DAY_SECONDS = 24 * 60 * 60;
const CREDENTIAL_DAYS = 7;
const RANDOMNESS_LENGTH = 32;

const textDecoder = new TextDecoder();

let serverPublicParams: wasm.ServerPublicParams | undefined;
let cachedCredentials: { day: number; response: GroupCredentialsResponse } | undefined;

/** Fetches and decrypts the current state of a group v2 from its master key */
export async function fetchGroup(
  account: AccountRecord, connection: ChatConnection, masterKey: Uint8Array,
): Promise<GroupState> {
  const secretParams = wasm.GroupSecretParams_DeriveFromMasterKey(masterKey);
  const publicParams = wasm.GroupSecretParams_GetPublicParams(secretParams);
  const authorization = await getGroupAuthorization(account, connection, secretParams, publicParams);

  const response = await sendHttpRequest(SIGNAL_STORAGE_HOST, {
    method: 'GET',
    path: '/v2/groups/',
    headers: { Authorization: `Basic ${authorization}` },
  });
  if (response.status !== HTTP_OK) throw new Error(`Group request failed with HTTP ${response.status}`);

  const { group } = GroupResponse.decode(response.body);
  if (!group) throw new Error('Group response has no group');
  return decryptGroupState(secretParams, group);
}

/** Decrypts a group's state with its secret params (`GroupSecretParams_DeriveFromMasterKey`) */
export function decryptGroupState(secretParams: Uint8Array, group: Group): GroupState {
  const publicParams = wasm.GroupSecretParams_GetPublicParams(secretParams);

  const decryptBytes = (blob: Uint8Array) => wasm.GroupSecretParams_DecryptBlobWithPadding(secretParams, blob);
  const decryptBlob = (blob?: Uint8Array) => (blob?.length ? GroupAttributeBlob.decode(decryptBytes(blob)) : undefined);
  const decryptText = (blob?: Uint8Array) => (blob?.length ? textDecoder.decode(decryptBytes(blob)) : undefined);
  const decryptServiceId = (ciphertext: Uint8Array) => (
    wasm.ServiceId_ServiceIdString(wasm.GroupSecretParams_DecryptServiceId(secretParams, ciphertext))
  );
  const decryptProfileKey = (ciphertext: Uint8Array | undefined, aci: string) => (
    ciphertext?.length
      ? wasm.GroupSecretParams_DecryptProfileKey(secretParams, ciphertext, wasm.ServiceId_ParseFromServiceIdString(aci))
      : undefined
  );

  return {
    groupId: bufferToBase64(wasm.GroupPublicParams_GetGroupIdentifier(publicParams)),
    revision: group.version ?? 0,
    title: decryptBlob(group.title)?.title,
    description: decryptBlob(group.description)?.descriptionText,
    avatarUrl: group.avatarUrl || undefined,
    expireTimer: decryptBlob(group.disappearingMessagesTimer)?.disappearingMessagesDuration,
    accessControl: group.accessControl,
    members: (group.members ?? []).map((member) => {
      const aci = decryptServiceId(member.userId!);
      return {
        aci,
        role: member.role,
        profileKey: decryptProfileKey(member.profileKey, aci),
        joinedAtRevision: member.joinedAtVersion,
        labelEmoji: decryptText(member.labelEmoji),
        label: decryptText(member.labelString),
      };
    }),
    pendingMembers: (group.membersPendingProfileKey ?? []).map(({ member, addedByUserId, timestamp }) => ({
      serviceId: decryptServiceId(member!.userId!),
      addedBy: addedByUserId?.length ? decryptServiceId(addedByUserId) : undefined,
      timestamp: timestamp !== undefined ? Number(timestamp) : undefined,
    })),
    requestingMembers: (group.membersPendingAdminApproval ?? []).map(({ userId, profileKey, timestamp }) => {
      const aci = decryptServiceId(userId!);
      return {
        aci,
        profileKey: decryptProfileKey(profileKey, aci),
        timestamp: timestamp !== undefined ? Number(timestamp) : undefined,
      };
    }),
    bannedMembers: (group.members_banned ?? []).map(({ userId, timestamp }) => ({
      serviceId: decryptServiceId(userId!),
      timestamp: timestamp !== undefined ? Number(timestamp) : undefined,
    })),
    inviteLinkPassword: group.inviteLinkPassword?.length ? group.inviteLinkPassword : undefined,
    isAnnouncementsOnly: group.announcements_only,
    isTerminated: group.terminated,
  };
}

/**
 * Builds the storage service group authorization: hex group public params and a zero-knowledge
 * presentation of today's auth credential, separated by a colon and base64-encoded
 */
async function getGroupAuthorization(
  account: AccountRecord, connection: ChatConnection, secretParams: Uint8Array, publicParams: Uint8Array,
) {
  if (!account.pni) throw new Error('Group access for accounts without a phone number is not supported yet');

  serverPublicParams ??= wasm.ServerPublicParams_Deserialize(bufferFromBase64(SIGNAL_ZKGROUP_SERVER_PUBLIC_PARAMS));
  const today = Math.floor(Date.now() / 1000 / DAY_SECONDS) * DAY_SECONDS;
  const { credentials } = await getGroupCredentials(connection, today);
  const todayCredential = credentials.find(({ redemptionTime }) => redemptionTime === today);
  if (!todayCredential) throw new Error('No group auth credential for today');

  const credential = wasm.ServerPublicParams_ReceiveAuthCredentialWithPniAsServiceId(
    serverPublicParams,
    wasm.ServiceId_ParseFromServiceIdString(account.aci),
    wasm.ServiceId_ParseFromServiceIdString(toPniServiceId(account.pni)),
    todayCredential.redemptionTime,
    bufferFromBase64(todayCredential.credential),
  );
  const presentation = wasm.ServerPublicParams_CreateAuthCredentialWithPniPresentationDeterministic(
    serverPublicParams, getRandomBytes(RANDOMNESS_LENGTH), secretParams, credential,
  );

  return bufferToBase64(encodeUtf8(`${bufferToHex(publicParams)}:${bufferToHex(presentation)}`));
}

async function getGroupCredentials(connection: ChatConnection, today: number) {
  if (cachedCredentials?.day === today) return cachedCredentials.response;

  const end = today + CREDENTIAL_DAYS * DAY_SECONDS;
  const { status, json } = await connection.sendJsonRequest<GroupCredentialsResponse>(
    'GET',
    `/v1/certificate/auth/group?redemptionStartSeconds=${today}&redemptionEndSeconds=${end}`
    + '&v101=true&zkcCredential=true',
  );
  if (status !== HTTP_OK || !json) throw new Error(`Group credentials request failed with HTTP ${status}`);

  cachedCredentials = { day: today, response: json };
  return json;
}
