import { fromBinary } from '@bufbuild/protobuf';

import type ChatConnection from '../chat/ChatConnection';
import type { Group, GroupChange } from '../proto/generated/Groups_pb';
import type { AccountRecord } from '../store/SignalStore';

import { sendGroupRequest } from './fetchGroup';
import { SUPPORTED_CHANGE_EPOCH } from './groupChange';

import { GroupChangesSchema } from '../proto/generated/Groups_pb';

export type GroupLogEntry = { change?: GroupChange; state?: Group };

const HTTP_PARTIAL_CONTENT = 206;
// `Content-Range: versions <start>-<end>/<current revision>` of a page (Signal Desktop `PARSE_GROUP_LOG_RANGE_HEADER`)
const RANGE_PATTERN = /^versions\s+(\d{1,10})-(\d{1,10})\/(\d{1,10})/;

/**
 * Fetches the signed changes from `fromRevision`, inclusive, to the current revision page by page, with the states
 * of the first and last revisions and send endorsements for the current members
 * (`GET /v2/groups/logs/{from}`, Signal Desktop `updateGroupViaLogs`)
 */
export async function fetchGroupLog(
  account: AccountRecord, connection: ChatConnection, secretParams: Uint8Array, fromRevision: number,
) {
  const entries: GroupLogEntry[] = [];
  let sendEndorsementsResponse: Uint8Array | undefined;
  let start = fromRevision;
  let isFirstPage = true;

  for (;;) {
    const response = await sendGroupRequest(account, connection, secretParams, {
      method: 'GET',
      path: `/v2/groups/logs/${start}?includeFirstState=${isFirstPage}&includeLastState=true`
        + `&maxSupportedChangeEpoch=${SUPPORTED_CHANGE_EPOCH}`,
      // Endorsements we hold are not reported, so the server sends new ones
      headers: { 'Cached-Send-Endorsements': '0' },
    });
    const { groupChanges, groupSendEndorsementsResponse } = fromBinary(GroupChangesSchema, response.body);
    entries.push(...groupChanges.map(({ groupChange, groupState }) => ({ change: groupChange, state: groupState })));
    if (groupSendEndorsementsResponse.length) sendEndorsementsResponse = groupSendEndorsementsResponse;

    const range = response.status === HTTP_PARTIAL_CONTENT
      ? response.headers.get('content-range')?.match(RANGE_PATTERN)
      : undefined;
    if (!range || Number(range[2]) >= Number(range[3])) break;
    start = Number(range[2]) + 1;
    isFirstPage = false;
  }

  return { entries, sendEndorsementsResponse };
}
