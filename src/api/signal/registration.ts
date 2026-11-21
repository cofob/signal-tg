import type { VerificationSession } from '../../lib/signal/account/register';
import type { AccountRecord } from '../../lib/signal/store/SignalStore';
import type { RegularLangFnParameters } from '../../util/localization/types';
import type { ApiAuthCodeTransport, ApiUpdateAuthorizationStateType } from '../types';

import {
  completeRegistration,
  createVerificationSession,
  registerAccount,
  RegistrationError,
  requestVerificationCode,
  submitCaptcha,
  submitVerificationCode,
} from '../../lib/signal/account/register';
import { formatMediaDuration } from '../../util/dates/duration';
import { logError, store } from './engine';
import { sendApiUpdate } from './updates';

type RegistrationState = {
  number?: string;
  session?: VerificationSession;
  codeTransport?: ApiAuthCodeTransport;
  // Registered on the server, waiting for its profile
  account?: AccountRecord;
};

const CAPTCHA_PREFIX = 'signalcaptcha://';
const MS_IN_SECOND = 1000;

let state: RegistrationState = {};
let languages: string[] = [];
// Changes when the flow restarts, so a step that finishes after a restart does not show its result
let generation = 0;

/**
 * Registers a new account with this browser as its primary device: phone number, captcha, code, then the
 * profile name, which completes the registration. The steps answer the app's authorization actions.
 */
export function startRegistration(langCode?: string) {
  resetRegistration();
  languages = [...new Set([langCode, ...navigator.languages].filter(Boolean))] as string[];
  sendAuthState('authorizationStateWaitPhoneNumber');
}

/** Shows the profile step of an account whose registration stopped after the server created it */
export function resumeRegistration(account: AccountRecord) {
  resetRegistration();
  state.account = account;
  sendAuthState('authorizationStateWaitRegistration');
}

export function resetRegistration() {
  generation++;
  state = {};
}

export function submitRegistrationPhoneNumber(phoneNumber: string) {
  const number = `+${phoneNumber}`;
  return runStep('authorizationStateWaitPhoneNumber', async () => {
    state.number = number;
    return handleSession(await createVerificationSession(number));
  });
}

export function submitRegistrationCaptcha(captchaLink: string) {
  const token = captchaLink.trim().replace(/\/$/, '');
  if (!token.startsWith(CAPTCHA_PREFIX) || token.length === CAPTCHA_PREFIX.length) {
    sendAuthState('authorizationStateWaitCaptcha');
    sendAuthError({ key: 'SignalCaptchaErrorFormat' });
    return Promise.resolve();
  }

  return runStep('authorizationStateWaitCaptcha', async () => {
    const session = await submitCaptcha(state.session!.id, token.slice(CAPTCHA_PREFIX.length));
    if (!session.allowedToRequestCode && session.requestedInformation.includes('captcha')) {
      state.session = session;
      return () => {
        sendAuthState('authorizationStateWaitCaptcha');
        sendAuthError({ key: 'SignalCaptchaErrorRejected' });
      };
    }
    return handleSession(session);
  });
}

export function requestRegistrationCode(transport: ApiAuthCodeTransport) {
  return runStep('authorizationStateWaitCode', () => requestCode(transport));
}

export function submitRegistrationCode(code: string) {
  return runStep('authorizationStateWaitCode', async () => {
    const session = await submitVerificationCode(state.session!.id, code);
    state.session = session;
    if (!session.verified) {
      return () => {
        sendCodeState();
        sendAuthError({ key: 'ErrorCodeInvalid' });
      };
    }
    return () => sendAuthState('authorizationStateWaitRegistration');
  });
}

/**
 * Creates the account with the verified session, unless it exists already, and completes it with the profile.
 * Resolves with the account once it is ready to connect.
 */
export async function submitRegistrationProfile({ firstName, lastName, isDiscoverableByPhoneNumber }: {
  firstName: string;
  lastName?: string;
  isDiscoverableByPhoneNumber?: boolean;
}) {
  let completedAccount: AccountRecord | undefined;
  await runStep('authorizationStateWaitRegistration', async () => {
    // A resumed registration keeps the discoverability it was created with
    state.account ??= await registerAccount(store, {
      number: state.number!,
      sessionId: state.session!.id,
      isDiscoverableByPhoneNumber: Boolean(isDiscoverableByPhoneNumber),
    });
    completedAccount = await completeRegistration(store, state.account, {
      givenName: firstName.trim(),
      familyName: lastName?.trim() || undefined,
    });
    return () => resetRegistration();
  });
  return completedAccount;
}

/** Moves to the step the session asks for; a session that allows a code request gets an SMS code right away */
async function handleSession(session: VerificationSession) {
  state.session = session;
  if (session.verified) return () => sendAuthState('authorizationStateWaitRegistration');
  if (session.allowedToRequestCode) return requestCode(session.nextSms !== undefined ? 'sms' : 'voice');
  if (session.requestedInformation.includes('captcha')) return () => sendAuthState('authorizationStateWaitCaptcha');

  // A push challenge needs a mobile push token, which a browser does not have
  return () => {
    sendAuthState('authorizationStateWaitPhoneNumber');
    sendAuthError({ key: 'SignalRegisterErrorChallenge' });
  };
}

async function requestCode(transport: ApiAuthCodeTransport) {
  state.session = await requestVerificationCode(state.session!.id, transport, languages);
  state.codeTransport = transport;
  return sendCodeState;
}

/**
 * Runs a step and shows its result: the next screen, or `screen` again with the error. Steps return the
 * update to show, so a step that a restart made stale shows nothing.
 */
async function runStep(screen: ApiUpdateAuthorizationStateType, step: () => Promise<() => void>) {
  const stepGeneration = generation;
  let showResult: () => void;
  try {
    showResult = await step();
  } catch (err) {
    showResult = () => showError(screen, err);
  }
  if (stepGeneration === generation) showResult();
}

function showError(screen: ApiUpdateAuthorizationStateType, err: unknown) {
  if (!(err instanceof RegistrationError)) {
    logError(err);
    sendAuthState(screen);
    sendAuthError({ key: 'ErrorUnexpected' });
    return;
  }

  if (err.session) state.session = { ...err.session, id: state.session!.id };
  switch (err.reason) {
    case 'invalidNumber':
      sendAuthState('authorizationStateWaitPhoneNumber');
      sendAuthError({ key: 'ErrorPhoneNumberInvalid' });
      break;
    case 'rateLimited': {
      const retryAfter = err.retryAfter ?? state.session?.nextVerificationAttempt;
      // A limited code request after the captcha or the number still leads to the code screen and its timers
      const isCodeScreen = screen !== 'authorizationStateWaitRegistration' && state.session?.allowedToRequestCode;
      sendScreen(isCodeScreen ? 'authorizationStateWaitCode' : screen);
      sendAuthError(retryAfter !== undefined
        ? { key: 'ErrorFloodTime', variables: { time: formatMediaDuration(retryAfter) } }
        : { key: 'ErrorUnexpected' });
      break;
    }
    case 'sessionNotFound':
      resetRegistration();
      sendAuthState('authorizationStateWaitPhoneNumber');
      sendAuthError({ key: 'SignalRegisterErrorSession' });
      break;
    case 'captchaRejected':
      sendAuthState('authorizationStateWaitCaptcha');
      sendAuthError({ key: 'SignalCaptchaErrorRejected' });
      break;
    case 'notReadyForVerification':
      if (state.session?.requestedInformation.includes('captcha')) {
        sendAuthState('authorizationStateWaitCaptcha');
        break;
      }
      sendScreen(screen);
      sendAuthError({ key: 'SignalCodeErrorNotRequested' });
      break;
    case 'codeSendFailed':
      sendCodeState();
      sendAuthError({ key: 'SignalCodeErrorSendFailed' });
      break;
    case 'codeNotDeliverable':
      sendCodeState();
      sendAuthError({ key: err.isPermanent ? 'SignalCodeErrorNoCode' : 'SignalCodeErrorUndeliverable' });
      break;
    case 'registrationLock':
      resetRegistration();
      sendAuthState('authorizationStateWaitPhoneNumber');
      sendAuthError({ key: 'SignalRegisterErrorRegLock' });
      break;
    case 'rejected':
      sendScreen(screen);
      sendAuthError({ key: 'SignalRegisterErrorRejected' });
      break;
    case 'network':
      sendScreen(screen);
      sendAuthError({ key: 'SignalRegisterErrorNetwork' });
      break;
  }
}

function sendScreen(screen: ApiUpdateAuthorizationStateType) {
  if (screen === 'authorizationStateWaitCode') {
    sendCodeState();
    return;
  }
  sendAuthState(screen);
}

/** The code screen with the session's resend times converted to local times */
function sendCodeState() {
  const { session, codeTransport } = state;
  const now = Date.now();
  sendApiUpdate({
    '@type': 'updateAuthorizationState',
    authorizationState: 'authorizationStateWaitCode',
    codeInfo: {
      transport: codeTransport,
      nextSmsAt: session?.nextSms !== undefined ? now + session.nextSms * MS_IN_SECOND : undefined,
      nextCallAt: session?.nextCall !== undefined ? now + session.nextCall * MS_IN_SECOND : undefined,
    },
  });
}

function sendAuthState(authorizationState: ApiUpdateAuthorizationStateType) {
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState });
}

function sendAuthError(errorKey: RegularLangFnParameters) {
  sendApiUpdate({ '@type': 'updateAuthorizationError', errorKey });
}
