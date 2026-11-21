import type ChatConnection from '../chat/ChatConnection';
import type { Credentials } from '../net/rest';
import type SignalClient from '../SignalClient';
import type { AccountRecord } from '../store/SignalStore';

import { SIGNAL_CHAT_HOST } from '../config';
import { bufferToHex } from '../../../util/encoding/buffer';
import { pause } from '../../../util/schedulers';
import { updateDeviceCapabilities } from '../account/capabilities';
import { getAccountCredentials } from '../account/linkDevice';
import { sendJsonRequest } from '../net/rest';
import { wasm } from '../wasm';
import { backupMasterKey, deleteMasterKeyBackup } from './svr2';

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const REGISTRATION_LOCK_PATH = '/v1/accounts/registration_lock';
const SVR_AUTH_PATH = '/v2/backup/auth';
const GUESS_COUNT_RESET_ATTEMPTS = 3;
const GUESS_COUNT_RESET_RETRY_DELAY_MS = 3000;

/**
 * Stores the master key in SVR2 under a new PIN, as Signal Android `SvrRepository.setPin`. Changing the PIN
 * also resets the guess count. Only a primary device can do this.
 */
export async function setAccountPin(client: SignalClient, pin: string) {
  const { connection, account } = client.getSenderContext();
  await backupMasterKey(await fetchSvrCredentials(connection), pin, getMasterKey(account));
  const updated = await client.updateAccount({ hasSvrPin: true });
  await updateDeviceCapabilities(connection, Boolean(updated.number), true);
}

/**
 * Deletes the PIN's SVR2 data after turning off the registration lock, which needs it, as Signal Android
 * `SvrRepository.optOutOfPin`
 */
export async function removeAccountPin(client: SignalClient) {
  const { connection } = client.getSenderContext();
  await setRegistrationLock(client, false);
  await deleteMasterKeyBackup(await fetchSvrCredentials(connection));
  const updated = await client.updateAccount({ hasSvrPin: undefined });
  await updateDeviceCapabilities(connection, Boolean(updated.number));
}

/**
 * Turns the registration lock on or off (`PUT` and `DELETE /v1/accounts/registration_lock`). While it is on,
 * registering the number again needs the PIN; its token derives from the master key that SVR2 stores.
 */
export async function setRegistrationLock(client: SignalClient, isEnabled: boolean) {
  const { connection, account } = client.getSenderContext();
  const { status } = isEnabled
    ? await connection.sendJsonRequest('PUT', REGISTRATION_LOCK_PATH, {
      registrationLock: bufferToHex(wasm.SvrKey_DeriveRegistrationLock(getMasterKey(account))),
    })
    : await connection.sendJsonRequest('DELETE', REGISTRATION_LOCK_PATH);
  if (status !== HTTP_OK && status !== HTTP_NO_CONTENT) {
    throw new Error(`Registration lock update failed with HTTP ${status}`);
  }
  await client.updateAccount({ isRegistrationLockEnabled: isEnabled || undefined });
}

/**
 * Stores the master key that the PIN restored again, with SVR2 credentials of the account that registration created,
 * which resets the guess count (Signal Android `ResetSvrGuessCountJob`). The account has no chat connection yet.
 */
export async function resetPinGuessCount(account: AccountRecord, pin: string, masterKey: Uint8Array) {
  for (let attempt = 1; ; attempt++) {
    try {
      const credentials = await sendJsonRequest<Credentials>(SIGNAL_CHAT_HOST, {
        method: 'GET', path: SVR_AUTH_PATH, credentials: getAccountCredentials(account),
      });
      if (!credentials) throw new Error('SVR2 credentials response is empty');
      await backupMasterKey(credentials, pin, masterKey);
      return;
    } catch (err) {
      if (attempt >= GUESS_COUNT_RESET_ATTEMPTS) throw err;
      await pause(GUESS_COUNT_RESET_RETRY_DELAY_MS * attempt);
    }
  }
}

/** Credentials for our SVR2 data (`GET /v2/backup/auth`, as Signal Desktop `getBackupAuth`) */
async function fetchSvrCredentials(connection: ChatConnection) {
  const { status, json } = await connection.sendJsonRequest<Credentials>('GET', SVR_AUTH_PATH);
  if (status !== HTTP_OK || !json) throw new Error(`SVR2 credentials request failed with HTTP ${status}`);
  return json;
}

function getMasterKey(account: AccountRecord) {
  if (account.masterKey) return account.masterKey;
  if (!account.accountEntropyPool) throw new Error('The account has no master key');
  return wasm.AccountEntropyPool_DeriveSvrKey(account.accountEntropyPool);
}
