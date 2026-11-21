import type MessageDb from '../db/MessageDb';
import type SignalClient from '../SignalClient';
import type { KeyTransparencySelfHealth } from '../store/SignalStore';

import { getServerTime } from '../../../util/serverTime';
import { wasm } from '../wasm';
import { createTransport, KeyTransparencyRequestError } from './transport';

import NetworkError from '../net/NetworkError';
import CheckScheduler from './CheckScheduler';

/** The identifiers of an account that changes the search for it, as the `AccountDataField` of the Node package */
export type KnownIdentifier = 'username' | 'phoneNumberDiscoverability';

type CheckRequest = {
  aci: string;
  identityKey: Uint8Array;
  // The number and the access key that the profile key of the account derives
  e164?: { number: string; accessKey: Uint8Array };
  usernameHash?: Uint8Array;
  // Our own account is checked more strictly: a newer version in the log than we know of is an error
  isSelf: boolean;
  isE164Discoverable: boolean;
};

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WEEK_MS = 7 * DAY_MS;
// The numbers of the Fibonacci sequence that Signal Desktop retries with, in seconds; requests are large
const RETRY_DELAYS_MS = [5, 8, 13, 21, 34, 55].map((seconds) => seconds * SECOND_MS);
// Signal Desktop waits this long after our number or username changed, which the log takes a while to show
const KNOWN_IDENTIFIER_CHANGE_DELAY_MS = 5 * MINUTE_MS;
const INTERMITTENT_ERROR_RETRY_DELAY_MS = DAY_MS;
// `AccountDataField.UsernameHash` of libsignal `KeyTransparency.ts`
const USERNAME_HASH_FIELD = 1;

/**
 * Automatic key verification (Signal Desktop `ts/services/keyTransparency.preload.ts`): checks that the identity key
 * of an account is the one that the key transparency log lists for it, and that our own account is listed as we
 * expect. The proofs are verified in WebAssembly (`rust/signal-wasm/src/keytrans`) with the production log keys. The
 * stored account data and the last distinguished tree head make later checks monitor the log instead of searching.
 */
export default class KeyTransparency {
  private scheduler: CheckScheduler;

  private selfCheckPromise?: Promise<void>;

  // Checks run one after another, since each reads the stored account data and the distinguished tree head and
  // writes them back
  private queue = Promise.resolve();

  constructor(private client: SignalClient, private db: MessageDb) {
    // A failed self check is kept in the health, and tries again at the time that it sets
    this.scheduler = new CheckScheduler(client.store, WEEK_MS, () => this.selfCheck().catch(() => undefined));
  }

  /** Runs the self check every week while the client is connected */
  start() {
    this.scheduler.start();
  }

  stop() {
    this.scheduler.stop();
  }

  /** Whether `aci` can be checked: only a contact that we know by phone number is listed in the log with it */
  async isContactAvailable(aci: string) {
    return Boolean((await this.db.getConversation(aci))?.e164);
  }

  /**
   * Checks the identity key of a contact, and our own account unless it is known to be healthy. Rejects when the
   * log does not list the key, or when the check cannot finish.
   */
  async checkContact(aci: string, signal?: AbortSignal) {
    const identity = await this.client.store.getIdentity(aci);
    if (!identity) throw new Error('The contact has no identity key');

    const e164 = (await this.db.getConversation(aci))?.e164;
    const recipient = await this.client.store.getRecipient(aci);
    await this.check({
      aci,
      identityKey: identity.publicKey,
      e164: e164 && recipient?.profileKey
        ? { number: e164, accessKey: wasm.ProfileKey_DeriveAccessKey(recipient.profileKey) }
        : undefined,
      isSelf: false,
      isE164Discoverable: true,
    }, signal);

    const selfHealth = await this.client.store.getItem('keyTransparencySelfHealth');
    if (selfHealth === undefined) {
      await this.selfCheck(signal);
    } else if (selfHealth !== 'ok') {
      throw new Error('The key transparency check of our own account failed');
    }
  }

  /** Checks that the log lists our identity key, number and username as we know them; the checks run one at a time */
  selfCheck(signal?: AbortSignal) {
    this.selfCheckPromise ??= this.runSelfCheck(signal).finally(() => {
      this.selfCheckPromise = undefined;
    });
    return this.selfCheckPromise;
  }

  /** The result of the last self check; `idle` before the first, or when the log could not be reached */
  async getSelfStatus(): Promise<'idle' | 'running' | 'ok' | 'fail'> {
    if (this.selfCheckPromise) return 'running';
    const health = await this.client.store.getItem('keyTransparencySelfHealth');
    if (health === 'ok') return 'ok';
    return health === 'fail' ? 'fail' : 'idle';
  }

  /** Forgets what the log held for the identifier that we changed, so the change is not taken for tampering */
  async onKnownIdentifierChange(identifier: KnownIdentifier) {
    if (identifier === 'username') {
      try {
        await this.resetOwnField(USERNAME_HASH_FIELD);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[signal] Resetting the key transparency username failed', err);
      }
    }
    await this.scheduler.delayBy(KNOWN_IDENTIFIER_CHANGE_DELAY_MS);
  }

  private async resetOwnField(field: number) {
    const { store } = this.client;
    const account = await store.getItem('account');
    const data = account && await store.getKeyTransparencyAccountData(account.aci);
    if (!data) return;

    const updated = wasm.KeyTransparency_ResetDataField(data, field);
    if (!updated.length) throw new TypeError('The stored key transparency data cannot be decoded');
    await store.setKeyTransparencyAccountData(account.aci, updated as Uint8Array<ArrayBuffer>);
  }

  private async runSelfCheck(signal?: AbortSignal) {
    const { store } = this.client;
    const account = await store.getItem('account');
    const keyPair = await store.getItem('aciIdentityKeyPair');
    if (!account || !keyPair) throw new Error('This browser is not linked to a Signal account');

    const username = (await this.db.getConversation(account.aci))?.username;
    try {
      await this.check({
        aci: account.aci,
        identityKey: keyPair.publicKey,
        e164: account.number && account.profileKey
          ? { number: account.number, accessKey: wasm.ProfileKey_DeriveAccessKey(account.profileKey) }
          : undefined,
        usernameHash: username ? wasm.Username_Hash(username) : undefined,
        isSelf: true,
        isE164Discoverable: !account.isPhoneNumberUnlisted,
      }, signal);
      signal?.throwIfAborted();
      await store.setItem('keyTransparencySelfHealth', 'ok');
    } catch (err) {
      if (signal?.aborted) throw err;

      const oldHealth = await store.getItem('keyTransparencySelfHealth');
      const newHealth = getSelfHealthAfterFailure(err, oldHealth);
      if (newHealth) {
        await store.setItem('keyTransparencySelfHealth', newHealth);
      } else {
        await store.removeItem('keyTransparencySelfHealth');
      }
      if (newHealth === 'intermittent') {
        await this.scheduler.runAt(Date.now() + INTERMITTENT_ERROR_RETRY_DELAY_MS);
      }
      throw err;
    }
  }

  /** Runs the check, again after a delay when the connection or the server failed */
  private async check(request: CheckRequest, signal?: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.enqueue(() => this.checkOnce(request, signal));
        return;
      } catch (err) {
        const delay = signal?.aborted ? undefined : getRetryDelay(err, attempt);
        if (delay === undefined) throw err;

        await sleep(delay, signal);
      }
    }
  }

  private enqueue<T>(task: () => Promise<T>) {
    const result = this.queue.then(task);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async checkOnce({
    aci, identityKey, e164, usernameHash, isSelf, isE164Discoverable,
  }: CheckRequest, signal?: AbortSignal) {
    // The socket without credentials would connect on its own, but a client that is not connected has no account to check
    if (!this.client.isConnected) throw new Error('Signal is not connected');
    const { store, unauthenticatedChat } = this.client.getSenderContext();
    signal?.throwIfAborted();

    const [accountData, distinguished] = await Promise.all([
      store.getKeyTransparencyAccountData(aci),
      store.getItem('keyTransparencyDistinguished'),
    ]);
    const [newAccountData, newDistinguished] = await wasm.KeyTransparency_Check(
      createTransport(unauthenticatedChat, signal),
      wasm.ServiceId_ParseFromServiceIdString(aci),
      wasm.PublicKey_Deserialize(identityKey),
      e164?.number,
      e164?.accessKey,
      usernameHash,
      accountData,
      distinguished,
      isSelf,
      isE164Discoverable,
      getServerTime() * SECOND_MS,
    ) as [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>];

    await store.setKeyTransparencyAccountData(aci, newAccountData);
    // Empty while the stored tree head stays, so its time is kept
    if (newDistinguished.length) await store.setItem('keyTransparencyDistinguished', newDistinguished);
  }
}

function getErrorName(err: unknown) {
  return (err as { libsignalName?: string } | undefined)?.libsignalName;
}

function getRetryDelay(err: unknown, attempt: number) {
  if (attempt >= RETRY_DELAYS_MS.length) return undefined;
  if (err instanceof KeyTransparencyRequestError) {
    if (err.isRateLimited) return (err.retryAfterSeconds ?? 0) * SECOND_MS || RETRY_DELAYS_MS[attempt];
    return err.isServerError ? RETRY_DELAYS_MS[attempt] : undefined;
  }
  return err instanceof NetworkError ? RETRY_DELAYS_MS[attempt] : undefined;
}

/**
 * The health after a failed self check (Signal Desktop `#selfCheck`). The first failed verification is only
 * `intermittent`, since the log may be a step behind a change made on another device; errors that do not show whether
 * the log is right keep an earlier failure and otherwise leave the health unknown.
 */
function getSelfHealthAfterFailure(
  err: unknown, oldHealth: KeyTransparencySelfHealth | undefined,
): KeyTransparencySelfHealth | undefined {
  const name = getErrorName(err);
  const isFailed = oldHealth === 'intermittent' || oldHealth === 'fail';
  if (name === 'KeyTransparencyVerificationFailed') return isFailed ? 'fail' : 'intermittent';
  if (name && name !== 'KeyTransparencyError') return 'fail';
  return isFailed ? oldHealth : undefined;
}

function sleep(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
