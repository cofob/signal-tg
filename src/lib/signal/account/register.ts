import type { HttpResponse } from '../net/http';
import type { Credentials } from '../net/rest';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord, KeyPairBytes } from '../store/SignalStore';

import { SIGNAL_CHAT_HOST, SIGNAL_PRIMARY_DEVICE_ID } from '../config';
import { bufferToBase64, bufferToHex } from '../../../util/encoding/buffer';
import { encodeUtf8, generateRegistrationId, getRandomBytes } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { getBasicAuthorization } from '../net/rest';
import { uploadProfile } from '../profiles/uploadProfile';
import { toPniServiceId } from '../serviceId';
import { wasm } from '../wasm';
import { getDeviceCapabilities } from './capabilities';
import { getAccountCredentials } from './linkDevice';
import { createLastResortPreKeys, saveLastResortPreKeys, uploadOneTimePreKeys } from './preKeys';

export type VerificationTransport = 'sms' | 'voice';

/** A verification session (`/v1/verification/session`); waits are in seconds from the response */
export type VerificationSession = {
  id: string;
  allowedToRequestCode: boolean;
  verified: boolean;
  // Absent when the transport cannot be used for this session
  nextSms?: number;
  nextCall?: number;
  nextVerificationAttempt?: number;
  // Challenges to answer before a code can be requested: `captcha`, `pushChallenge`
  requestedInformation: string[];
};

export type RegistrationErrorReason =
  | 'invalidNumber'
  | 'rateLimited'
  | 'sessionNotFound'
  | 'captchaRejected'
  | 'notReadyForVerification'
  | 'codeSendFailed'
  | 'codeNotDeliverable'
  | 'registrationLock'
  | 'rejected'
  // The request did not reach Signal: the tunnel is down or does not answer
  | 'network';

type SessionResponse = Omit<VerificationSession, 'id' | 'requestedInformation'> & {
  id?: string;
  requestedInformation?: string[];
};

type CodeNotDeliverableResponse = {
  reason?: string;
  permanentFailure?: boolean;
};

type RegistrationLockResponse = {
  // Milliseconds until the lock expires and the number can be registered without the PIN
  timeRemaining?: number;
  svr2Credentials?: Credentials;
};

type RegistrationResponse = {
  uuid: string;
  pni?: string;
  number?: string;
};

type RegistrationKeys = {
  identityKeyPair: KeyPairBytes;
  lastResortPreKeys: ReturnType<typeof createLastResortPreKeys>;
};

export class RegistrationError extends Error {
  constructor(
    readonly reason: RegistrationErrorReason,
    // 0 when the request did not reach Signal
    readonly status: number,
    // Seconds from `Retry-After` of a 429 response
    readonly retryAfter?: number,
    // The session state that 409, 418 and 429 responses to code requests carry
    readonly session?: VerificationSession,
    // A code can never be delivered to this number (440 `permanentFailure`)
    readonly isPermanent?: boolean,
  ) {
    super(`Registration request failed with HTTP ${status}: ${reason}`);
  }
}

const SESSION_PATH = '/v1/verification/session';
// The `client` of code requests picks the SMS format; Signal Desktop sends `desktop`
const VERIFICATION_CLIENT = 'desktop';
// Characters of a URL path segment that libsignal accepts in session ids (`SessionId::new`)
const SESSION_ID_REGEX = /^[A-Za-z0-9\-_.~!$&,()*+;=:@]+$/;
const PASSWORD_BYTES = 16;
const PROFILE_KEY_LENGTH = 32;
const MEDIA_ROOT_BACKUP_KEY_LENGTH = 32;
const HTTP_MULTIPLE_CHOICES = 300;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_TEAPOT = 418;
const HTTP_UNPROCESSABLE = 422;
const HTTP_LOCKED = 423;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_NOT_DELIVERABLE = 440;

const textDecoder = new TextDecoder();

/** The number has Registration Lock (423): the PIN restores the master key from SVR2 with `svr2Credentials` */
export class RegistrationLockError extends RegistrationError {
  constructor(
    // Milliseconds until the lock expires
    readonly timeRemaining: number | undefined,
    // Absent when the lock has no SVR2 data, so only waiting for its expiry helps
    readonly svr2Credentials: Credentials | undefined,
  ) {
    super('registrationLock', HTTP_LOCKED);
  }
}

/**
 * Starts phone number verification (`POST /v1/verification/session`). Without a push token the session
 * asks for a captcha before it allows a code request. The flow follows libsignal-net
 * `rust/net/chat/src/ws/registration` and Signal Desktop `ts/state/ducks/standaloneInstaller.preload.ts`.
 */
export async function createVerificationSession(number: string) {
  const response = await sendRegistrationRequest('POST', SESSION_PATH, { number });
  if (response.status === HTTP_BAD_REQUEST || response.status === HTTP_UNPROCESSABLE) {
    throw new RegistrationError('invalidNumber', response.status);
  }
  return parseSessionResponse(response);
}

/** Answers the captcha challenge with the token of a `signalcaptcha://` link (`PATCH` of the session) */
export async function submitCaptcha(sessionId: string, captcha: string) {
  const response = await sendRegistrationRequest('PATCH', getSessionPath(sessionId), { captcha });
  if (response.status === HTTP_FORBIDDEN) throw new RegistrationError('captchaRejected', response.status);
  return parseSessionResponse(response, sessionId);
}

/** Asks the server to send a code by SMS or voice call; `languages` pick the message language */
export async function requestVerificationCode(
  sessionId: string, transport: VerificationTransport, languages: string[],
) {
  const response = await sendRegistrationRequest('POST', `${getSessionPath(sessionId)}/code`, {
    transport,
    client: VERIFICATION_CLIENT,
  }, languages.length ? { 'Accept-Language': languages.join(',') } : undefined);

  if (response.status === HTTP_NOT_DELIVERABLE) {
    const json = parseJson<CodeNotDeliverableResponse>(response);
    throw new RegistrationError(
      'codeNotDeliverable', response.status, undefined, undefined, Boolean(json?.permanentFailure),
    );
  }
  return parseSessionResponse(response, sessionId);
}

/** Submits the received code; the returned session is `verified` only when the code was right */
export function submitVerificationCode(sessionId: string, code: string) {
  return sendRegistrationRequest('PUT', `${getSessionPath(sessionId)}/code`, { code })
    .then((response) => parseSessionResponse(response, sessionId));
}

/**
 * Creates the account of a verified session with this browser as its primary device (`POST /v1/registration`)
 * and stores it as `isRegistrationPending` until `completeRegistration`. Port of Signal Desktop
 * `AccountManager.registerAsPrimaryDevice` and `WebAPI.createAccount` with the request shape of libsignal-net
 * `RegisterChatRequest`. A number with Registration Lock needs `masterKey`, which SVR2 restores with the PIN: the
 * account keeps it and its lock, as in Signal Desktop `standaloneInstaller` `verifyPIN`.
 */
export async function registerAccount(store: SignalStore, {
  number, sessionId, isDiscoverableByPhoneNumber, masterKey,
}: {
  number: string;
  sessionId: string;
  isDiscoverableByPhoneNumber: boolean;
  masterKey?: Uint8Array;
}) {
  const aciKeys = generateRegistrationKeys();
  const pniKeys = generateRegistrationKeys();
  // The base64 of 16 random bytes without its `==` padding
  const password = bufferToBase64(getRandomBytes(PASSWORD_BYTES)).slice(0, -2);
  const registrationId = generateRegistrationId();
  const pniRegistrationId = generateRegistrationId();
  const profileKey = getRandomBytes(PROFILE_KEY_LENGTH);
  const accountEntropyPool = masterKey ? undefined : wasm.AccountEntropyPool_Generate();
  const svrKey = masterKey ?? wasm.AccountEntropyPool_DeriveSvrKey(accountEntropyPool!);

  const response = await sendRegistrationRequest('POST', '/v1/registration', {
    sessionId,
    accountAttributes: {
      fetchesMessages: true,
      registrationId,
      pniRegistrationId,
      recoveryPassword: bufferToBase64(wasm.SvrKey_DeriveRegistrationRecoveryPassword(svrKey)),
      unidentifiedAccessKey: bufferToBase64(wasm.ProfileKey_DeriveAccessKey(profileKey)),
      unrestrictedUnidentifiedAccess: false,
      capabilities: getDeviceCapabilities(true, Boolean(masterKey)),
      discoverableByPhoneNumber: isDiscoverableByPhoneNumber,
      registrationLock: masterKey ? bufferToHex(wasm.SvrKey_DeriveRegistrationLock(masterKey)) : undefined,
    },
    skipDeviceTransfer: true,
    aciIdentityKey: bufferToBase64(aciKeys.identityKeyPair.publicKey),
    pniIdentityKey: bufferToBase64(pniKeys.identityKeyPair.publicKey),
    aciSignedPreKey: aciKeys.lastResortPreKeys.signedPreKey.upload,
    pniSignedPreKey: pniKeys.lastResortPreKeys.signedPreKey.upload,
    aciPqLastResortPreKey: aciKeys.lastResortPreKeys.pqLastResortPreKey.upload,
    pniPqLastResortPreKey: pniKeys.lastResortPreKeys.pqLastResortPreKey.upload,
  }, undefined, { username: number, password });

  const { status } = response;
  if (status === HTTP_UNAUTHORIZED) throw new RegistrationError('sessionNotFound', status);
  if (status === HTTP_LOCKED) {
    const json = parseJson<RegistrationLockResponse>(response);
    const credentials = json?.svr2Credentials;
    throw new RegistrationLockError(json?.timeRemaining, credentials?.username ? credentials : undefined);
  }
  // 409 asks for a device transfer, which `skipDeviceTransfer` declines
  if (status === HTTP_BAD_REQUEST || status === HTTP_FORBIDDEN || status === HTTP_CONFLICT) {
    throw new RegistrationError('rejected', status);
  }
  throwOnFailure(response);

  const json = parseJson<RegistrationResponse>(response);
  if (!json?.uuid || !json.pni) throw new Error('Registration response has no ACI or PNI');
  const { uuid: aci, pni } = json;
  const pniServiceId = toPniServiceId(pni);

  await store.setItem('aciIdentityKeyPair', aciKeys.identityKeyPair);
  await store.setItem('pniIdentityKeyPair', pniKeys.identityKeyPair);
  await saveLastResortPreKeys(store, aci, aciKeys.lastResortPreKeys);
  await saveLastResortPreKeys(store, pniServiceId, pniKeys.lastResortPreKeys);

  const account: AccountRecord = {
    aci,
    pni,
    number: json.number || number,
    deviceId: SIGNAL_PRIMARY_DEVICE_ID,
    password,
    registrationId,
    pniRegistrationId,
    profileKey,
    accountEntropyPool,
    masterKey,
    mediaRootBackupKey: getRandomBytes(MEDIA_ROOT_BACKUP_KEY_LENGTH),
    isDiscoverableByPhoneNumber,
    hasSvrPin: masterKey ? true : undefined,
    isRegistrationLockEnabled: masterKey ? true : undefined,
    isReadReceiptsEnabled: true,
    // A primary device has no other device to ask for contacts, groups and keys
    isInitialSyncDone: true,
    isRegistrationPending: true,
  };
  await store.setItem('account', account);
  return account;
}

/**
 * Uploads one-time prekeys and the profile with our name, which a new account needs before it is used.
 * Each step can run again, so a registration that stopped here resumes with the same calls.
 */
export async function completeRegistration(
  store: SignalStore, account: AccountRecord, name: { givenName: string; familyName?: string },
) {
  const credentials = getAccountCredentials(account);
  const pniServiceId = toPniServiceId(account.pni!);
  await uploadOneTimePreKeys(store, credentials, 'aci', account.aci, (await store.getItem('aciIdentityKeyPair'))!);
  await uploadOneTimePreKeys(
    store, credentials, 'pni', pniServiceId, (await store.getItem('pniIdentityKeyPair'))!,
  );
  await uploadProfile(credentials, { aci: account.aci, profileKey: account.profileKey!, ...name });

  const completedAccount = { ...account, isRegistrationPending: undefined };
  await store.setItem('account', completedAccount);
  return completedAccount;
}

function generateRegistrationKeys(): RegistrationKeys {
  const privateKey = wasm.PrivateKey_Generate();
  const identityKeyPair = {
    privateKey: wasm.PrivateKey_Serialize(privateKey),
    publicKey: wasm.PublicKey_Serialize(wasm.PrivateKey_GetPublicKey(privateKey)),
  };
  return { identityKeyPair, lastResortPreKeys: createLastResortPreKeys(identityKeyPair) };
}

function getSessionPath(sessionId: string) {
  if (!SESSION_ID_REGEX.test(sessionId)) throw new Error('Invalid verification session id');
  return `${SESSION_PATH}/${sessionId}`;
}

async function sendRegistrationRequest(
  method: string,
  path: string,
  json: unknown,
  extraHeaders?: Record<string, string>,
  credentials?: Credentials,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
  if (credentials) headers.Authorization = getBasicAuthorization(credentials);
  try {
    return await sendHttpRequest(SIGNAL_CHAT_HOST, {
      method, path, headers, body: encodeUtf8(JSON.stringify(json)),
    });
  } catch {
    throw new RegistrationError('network', 0);
  }
}

/** Maps the statuses that verification session endpoints share (libsignal-net `ws/registration/error.rs`) */
function parseSessionResponse(response: HttpResponse, sessionId?: string): VerificationSession {
  const { status } = response;
  const json = parseJson<SessionResponse>(response);
  const session = json ? buildSession(json, sessionId) : undefined;

  if (status === HTTP_BAD_REQUEST || status === HTTP_NOT_FOUND) {
    throw new RegistrationError('sessionNotFound', status);
  }
  if (status === HTTP_CONFLICT) throw new RegistrationError('notReadyForVerification', status, undefined, session);
  if (status === HTTP_TEAPOT) throw new RegistrationError('codeSendFailed', status, undefined, session);
  throwOnFailure(response, session);

  if (!session?.id) throw new Error('Verification session response has no id');
  return session;
}

function throwOnFailure(response: HttpResponse, session?: VerificationSession) {
  const { status, headers } = response;
  if (status === HTTP_TOO_MANY_REQUESTS) {
    const retryAfter = Number(headers.get('retry-after'));
    throw new RegistrationError('rateLimited', status, Number.isFinite(retryAfter) ? retryAfter : undefined, session);
  }
  if (status >= HTTP_MULTIPLE_CHOICES) throw new Error(`Registration request failed with HTTP ${status}`);
}

function buildSession(json: SessionResponse, sessionId?: string): VerificationSession {
  return {
    id: json.id ?? sessionId ?? '',
    allowedToRequestCode: Boolean(json.allowedToRequestCode),
    verified: Boolean(json.verified),
    nextSms: json.nextSms ?? undefined,
    nextCall: json.nextCall ?? undefined,
    nextVerificationAttempt: json.nextVerificationAttempt ?? undefined,
    requestedInformation: json.requestedInformation ?? [],
  };
}

function parseJson<T>(response: HttpResponse): T | undefined {
  const text = textDecoder.decode(response.body);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
