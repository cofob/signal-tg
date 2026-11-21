import type { ApiAuthCodeTransport } from '../../types';

import { startSession, switchToDeviceLink, switchToRegistration } from '../client';
import { logError } from '../engine';
import {
  requestRegistrationCode,
  submitRegistrationCaptcha,
  submitRegistrationCode,
  submitRegistrationPhoneNumber,
  submitRegistrationPin,
  submitRegistrationProfile,
} from '../registration';

// Registration of a new account with a phone number; the link QR code stays the default way to sign in

export function provideAuthPhoneNumber(phoneNumber: string) {
  void submitRegistrationPhoneNumber(phoneNumber);
}

export function provideAuthCaptcha(captchaLink: string) {
  void submitRegistrationCaptcha(captchaLink);
}

export function requestAuthCode(transport: ApiAuthCodeTransport) {
  void requestRegistrationCode(transport);
}

export function provideAuthCode(code: string) {
  void submitRegistrationCode(code);
}

export function provideAuthRegistration(registration: {
  firstName: string;
  lastName: string;
  isDiscoverableByPhoneNumber?: boolean;
}) {
  void submitRegistrationProfile(registration).then((account) => {
    if (account) return startSession(account);
    return undefined;
  }).catch(logError);
}

/** The Signal PIN of a number with Registration Lock, entered on the password screen */
export function provideAuthPassword(pin: string) {
  void submitRegistrationPin(pin).then((account) => {
    if (account) return startSession(account);
    return undefined;
  }).catch(logError);
}

/** Returns to phone number entry: from the link QR code, or to correct the number */
export function restartAuth() {
  switchToRegistration();
}

export function restartAuthWithQr() {
  switchToDeviceLink();
}
