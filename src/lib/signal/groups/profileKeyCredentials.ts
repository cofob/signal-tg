import type ChatConnection from '../chat/ChatConnection';
import type SignalStore from '../store/SignalStore';

import { bufferFromBase64, buffersEqual, bufferToHex } from '../../../util/encoding/buffer';
import { getServerTime } from '../../../util/serverTime';
import { getRandomBytes } from '../crypto';
import { wasm } from '../wasm';
import { getServerPublicParams } from './fetchGroup';

type CredentialProfileResponse = { credential?: string };

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const RANDOMNESS_LENGTH = 32;
// A credential is fetched again when it expires within this margin, so a group change does not carry a stale one
const EXPIRATION_MARGIN_SECONDS = 60 * 60;

const textDecoder = new TextDecoder();

/**
 * Returns an expiring profile key credential for `aci`, which group changes present to add the user as a full
 * member, or `undefined` when we have no profile key or the server has no profile for it. Credentials are kept
 * per profile key until they expire (Signal Desktop `ts/services/profiles.preload.ts`, `getProfileKeyCredential`).
 */
export async function getProfileKeyCredential(
  store: SignalStore, connection: ChatConnection, aci: string, profileKey?: Uint8Array,
) {
  const recipient = await store.getRecipient(aci);
  const key = profileKey ?? recipient?.profileKey;
  if (!key) return undefined;

  const stored = recipient?.profileKeyCredential;
  if (stored && buffersEqual(stored.profileKey, key)
    && stored.expiresAt - EXPIRATION_MARGIN_SECONDS > getServerTime()) {
    return stored.credential;
  }

  const credential = await fetchProfileKeyCredential(connection, aci, key);
  if (!credential) return undefined;
  await store.updateRecipient(aci, {
    profileKeyCredential: {
      credential,
      profileKey: key,
      expiresAt: wasm.ExpiringProfileKeyCredential_GetExpirationTime(credential),
    },
  });
  return credential;
}

/** Drops stored credentials, as after the server rejected a change that presented them */
export async function forgetProfileKeyCredentials(store: SignalStore, acis: string[]) {
  for (const aci of acis) {
    if ((await store.getRecipient(aci))?.profileKeyCredential) {
      await store.updateRecipient(aci, { profileKeyCredential: undefined });
    }
  }
}

/** A credential presentation that adds the credential's owner to the group of `secretParams` */
export function createProfileKeyCredentialPresentation(secretParams: Uint8Array, credential: Uint8Array) {
  return wasm.ServerPublicParams_CreateExpiringProfileKeyCredentialPresentationDeterministic(
    getServerPublicParams(), getRandomBytes(RANDOMNESS_LENGTH), secretParams, credential,
  );
}

/**
 * Requests the versioned profile with a credential request
 * (`GET /v1/profile/{aci}/{version}/{request}?credentialType=expiringProfileKey`)
 */
async function fetchProfileKeyCredential(connection: ChatConnection, aci: string, profileKey: Uint8Array) {
  const params = getServerPublicParams();
  const serviceId = wasm.ServiceId_ParseFromServiceIdString(aci);
  const version = textDecoder.decode(wasm.ProfileKey_GetProfileKeyVersion(profileKey, serviceId));
  const context = wasm.ServerPublicParams_CreateProfileKeyCredentialRequestContextDeterministic(
    params, getRandomBytes(RANDOMNESS_LENGTH), serviceId, profileKey,
  );
  const request = bufferToHex(wasm.ProfileKeyCredentialRequestContext_GetRequest(context));

  const { status, json } = await connection.sendJsonRequest<CredentialProfileResponse>(
    'GET', `/v1/profile/${aci}/${version}/${request}?credentialType=expiringProfileKey`,
  );
  if (status === HTTP_NOT_FOUND || status === HTTP_UNAUTHORIZED) return undefined;
  if (status !== HTTP_OK || !json) throw new Error(`Profile credential request for ${aci} failed with HTTP ${status}`);
  if (!json.credential) return undefined;

  return wasm.ServerPublicParams_ReceiveExpiringProfileKeyCredential(
    params, context, bufferFromBase64(json.credential), getServerTime(),
  );
}
