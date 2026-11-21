import type { AccountRecord } from '../store/SignalStore';

import { SIGNAL_CHAT_HOST } from '../config';
import { bufferToBase64, bufferToHex } from '../../../util/encoding/buffer';
import { sendJsonRequest } from '../net/rest';
import { wasm } from '../wasm';
import { getDeviceCapabilities } from './capabilities';
import { getAccountCredentials } from './linkDevice';

/**
 * Sends the attributes of a primary device again (`PUT /v1/accounts/attributes`, Signal Android
 * `AccountManager.setAccountAttributes`): the recovery password follows the account entropy pool, which a restore
 * from a backup replaces
 */
export async function updateAccountAttributes(account: AccountRecord) {
  const svrKey = account.masterKey ?? wasm.AccountEntropyPool_DeriveSvrKey(account.accountEntropyPool!);
  await sendJsonRequest(SIGNAL_CHAT_HOST, {
    method: 'PUT',
    path: '/v1/accounts/attributes',
    credentials: getAccountCredentials(account),
    json: {
      fetchesMessages: true,
      registrationId: account.registrationId,
      pniRegistrationId: account.pniRegistrationId,
      recoveryPassword: bufferToBase64(wasm.SvrKey_DeriveRegistrationRecoveryPassword(svrKey)),
      unidentifiedAccessKey: bufferToBase64(wasm.ProfileKey_DeriveAccessKey(account.profileKey!)),
      unrestrictedUnidentifiedAccess: false,
      capabilities: getDeviceCapabilities(Boolean(account.number), account.hasSvrPin),
      discoverableByPhoneNumber: !account.isPhoneNumberUnlisted,
      registrationLock: account.isRegistrationLockEnabled
        ? bufferToHex(wasm.SvrKey_DeriveRegistrationLock(svrKey)) : undefined,
    },
  });
}
