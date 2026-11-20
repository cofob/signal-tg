import type SignalStore from '../store/SignalStore';
import type { GroupSendEndorsementsRecord } from '../store/SignalStore';

import { concat } from '../../../util/encoding/buffer';
import { getServerTime } from '../../../util/serverTime';
import { wasm } from '../wasm';
import { getServerPublicParams } from './fetchGroup';

// Endorsements are used while they are valid for more than two hours and expire within two days
// (Signal Desktop `ts/util/groupSendEndorsements.preload.ts`, `validateGroupSendEndorsementsExpiration`)
const MIN_REMAINING_SECONDS = 2 * 60 * 60;
const MAX_REMAINING_SECONDS = 2 * 24 * 60 * 60;

/**
 * Verifies the send endorsements that come with a group state and stores them, or removes the stored ones
 * when there are none, as for groups we are not a full member of (Signal Desktop
 * `decodeGroupSendEndorsementsResponse`). `memberAcis` are the full members, us included.
 */
export async function saveGroupSendEndorsements(
  store: SignalStore,
  ourAci: string,
  groupId: string,
  secretParams: Uint8Array,
  memberAcis: string[],
  response?: Uint8Array,
) {
  if (!response) {
    await store.removeGroupSendEndorsements(groupId);
    return;
  }

  const members = memberAcis.map((aci) => wasm.ServiceId_ParseFromServiceIdString(aci));
  const endorsements = wasm.GroupSendEndorsementsResponse_ReceiveAndCombineWithServiceIds(
    response,
    concat(...members),
    wasm.ServiceId_ParseFromServiceIdString(ourAci),
    getServerTime(),
    secretParams,
    getServerPublicParams(),
  );
  await store.setGroupSendEndorsements(groupId, {
    expiration: wasm.GroupSendEndorsementsResponse_GetExpiration(response),
    members: Object.fromEntries(memberAcis.map((aci, index) => [aci, endorsements[index]])),
    combined: endorsements[memberAcis.length],
  });
}

/** Whether the expiration of `record` allows sends now */
export function getAreGroupSendEndorsementsCurrent(record: GroupSendEndorsementsRecord) {
  const remaining = record.expiration - getServerTime();
  return remaining > MIN_REMAINING_SECONDS && remaining < MAX_REMAINING_SECONDS;
}

/**
 * Builds the `Group-Send-Token` for a send to `serviceIds`, endorsed members other than us. It combines
 * whichever endorsements take fewer operations (Signal Desktop `GroupSendEndorsementState.buildToken`).
 */
export function buildGroupSendToken(
  record: GroupSendEndorsementsRecord, ourAci: string, secretParams: Uint8Array, serviceIds: string[],
) {
  const recipients = new Set(serviceIds);
  const others = Object.keys(record.members).filter((aci) => aci !== ourAci && !recipients.has(aci));
  const memberCount = Object.keys(record.members).length;

  let endorsement: Uint8Array;
  if (serviceIds.length === 1) {
    endorsement = record.members[serviceIds[0]];
  } else if (!others.length) {
    endorsement = record.combined;
  } else if (others.length < memberCount / 2) {
    endorsement = wasm.GroupSendEndorsement_Remove(
      record.combined, wasm.GroupSendEndorsement_Combine(others.map((aci) => record.members[aci])),
    );
  } else {
    endorsement = wasm.GroupSendEndorsement_Combine(serviceIds.map((serviceId) => record.members[serviceId]));
  }

  return wasm.GroupSendToken_ToFullToken(
    wasm.GroupSendEndorsement_ToToken(endorsement, secretParams), record.expiration,
  );
}
