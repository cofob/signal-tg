import type MessageDb from '../db/MessageDb';
import type SignalClient from '../SignalClient';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord, BackupFrequency, BackupSettings } from '../store/SignalStore';
import type { ArchiveAuth, ArchiveKeys } from './archiveApi';
import type { BackupExportStats } from './exportBackup';

import { SIGNAL_PRIMARY_DEVICE_ID } from '../config';
import { getServerTime } from '../../../util/serverTime';
import { createNewBackupChain, removeBackup, restoreBackup, storeBackup, SvrBError } from '../svr/svrb';
import { wasm } from '../wasm';
import {
  ArchiveError,
  clearArchiveCredentials,
  deleteArchive,
  ensureArchivePublicKey,
  getArchiveAuth,
  getArchiveFileInfo,
  getArchiveInfo,
  getArchiveReadHeaders,
  getSvrBCredentials,
  refreshArchive,
  uploadArchive,
} from './archiveApi';
import { BackupHeaderError, deriveMessageBackupKeys, readForwardSecrecyMetadata } from './backupStream';
import { writeBackupFile } from './backupWriter';
import { createBackupExport } from './exportBackup';
import { BackupValidationError, validateBackupFile } from './validateBackup';

export type BackupUnavailableReason =
  // The account has no account entropy pool, which the keys of a backup come from: a registration that a PIN restored
  | 'noRecoveryKey'
  // The backup header carries a random root key that registration generates and linking brings
  | 'noMediaRootKey';

export type BackupStep = 'exporting' | 'validating' | 'uploading';

/** The service holds a backup of the account that turning backups on would replace, which the user has to confirm */
export class ExistingBackupError extends Error {
  constructor() {
    super('A backup exists');
  }
}

/** The account is not the primary device, which alone turns backups on and writes them */
export class NotPrimaryDeviceError extends Error {
  constructor() {
    super('Backups are turned on from the primary device');
  }
}

export type BackupProgress = {
  step: BackupStep;
  // From 0 to 1, while uploading
  progress?: number;
};

/** What the backup service and the CDN hold for the account; each part is `undefined` when it is not known */
export type BackupRemoteStatus = {
  // The level of the credential: 200 is the free tier
  tier?: number;
  hasBackup: boolean;
  size?: number;
  // Milliseconds since the epoch
  modifiedAt?: number;
};

export type BackupResult = {
  size: number;
  stats: BackupExportStats;
};

type BackupServiceOptions = {
  store: SignalStore;
  db: MessageDb;
  client: SignalClient;
  appVersion: string;
  // The backup runs while a connection is up, so messages that wait on the server are in the database
  getIsConnected(): boolean;
  // Called after the settings changed or a backup began or ended
  onChange(): void;
  onError(error: unknown): void;
};

const MS_PER_SECOND = 1000;
const PERCENT = 100;
const MS_PER_DAY = 24 * 60 * 60 * MS_PER_SECOND;
// Signal Android `BackupFrequency` and `BackupMessagesJob`
const FREQUENCY_INTERVALS: Record<BackupFrequency, number | undefined> = {
  daily: MS_PER_DAY,
  weekly: 7 * MS_PER_DAY,
  monthly: 30 * MS_PER_DAY,
  manual: undefined,
};
export const DEFAULT_BACKUP_FREQUENCY: BackupFrequency = 'daily';
// The failure of a run that is not stated again by another: the schedule resumes with a success
const CLEARED_FAILURE = {
  lastError: undefined, failureCount: undefined, nextAttemptAt: undefined, isStopped: undefined,
} satisfies Partial<BackupSettings>;
// A credential that does not fit the key, a refused signature after the key was told again, and a file that the
// validator rejects: waiting does not change them
const STOPPING_FAILURES = ['unauthorized', 'verificationFailed', 'validation'];
// The reasons of `SvrBError` that say that the enclaves cannot open what the service has
const PERMANENT_SVRB_REASONS = ['dataMissing', 'restoreFailed', 'invalidData', 'decryptionFailed'];
// Signal Android `BackupMessagesJob.TOO_LARGE_MESSAGE_CUTTOFF_DURATION`
const TOO_LARGE_MESSAGE_DAYS = 365;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
// After a failed run the next one waits this long, and twice as long after each further failure, up to a day
const BACKOFF_BASE_MS = 5 * 60 * MS_PER_SECOND;
const BACKOFF_MAX_MS = MS_PER_DAY;
const FIRST_CHECK_DELAY_MS = 30 * MS_PER_SECOND;
// Signal Desktop `BACKUP_REFRESH_INTERVAL`: the backup is refreshed daily, so the service does not delete it as unused
const REFRESH_INTERVAL_MS = MS_PER_DAY;

/**
 * Signal Secure Backups of the free tier: the account's messages go to the backup service as one encrypted file, which
 * Signal Android and iOS restore at registration with the recovery key. The settings are on the account, a run
 * exports, validates and uploads (`BackupMessagesJob` in Signal Android; Signal Desktop `BackupsService`), and while
 * the app is open a timer starts the run the frequency asks for and refreshes the backup daily.
 */
export default class BackupService {
  private isRunning = false;

  private timer?: ReturnType<typeof setInterval>;

  private firstCheckTimer?: ReturnType<typeof setTimeout>;

  private abortController?: AbortController;

  // The run in progress, which `disable` waits for
  private runPromise?: Promise<unknown>;

  private currentProgress?: BackupProgress;

  constructor(private options: BackupServiceOptions) {}

  /** Whether this account has what backups need, and what is missing otherwise */
  static getUnavailableReason(account: AccountRecord): BackupUnavailableReason | undefined {
    if (!account.accountEntropyPool) return 'noRecoveryKey';
    if (!account.mediaRootBackupKey) return 'noMediaRootKey';
    return undefined;
  }

  get isBackingUp() {
    return this.isRunning;
  }

  /** The step of the backup that is running, with the share of the upload that went out */
  get progress() {
    return this.currentProgress;
  }

  /**
   * Turns backups on: reserves the backup id (a primary device does; a linked device needs a primary device that has
   * enabled backups already, as in Signal Desktop), tells the service the public keys, and makes a first backup.
   */
  async enable(frequency: BackupFrequency = DEFAULT_BACKUP_FREQUENCY, shouldReplaceBackup?: boolean) {
    const { account, keys } = await this.getKeys({ isPrimaryRequired: true });
    const messagesAuth = await this.getAuth(account, keys, 'messages', true);
    // The first backup replaces the one that the service holds, such as the backup of a phone that was turned in
    if (!shouldReplaceBackup && !account.backups?.isEnabled && await this.hasRemoteBackup(messagesAuth)) {
      throw new ExistingBackupError();
    }
    const tier = await this.getTier(account, keys, messagesAuth);
    await this.options.client.updateAccount({
      backups: { ...account.backups, ...CLEARED_FAILURE, isEnabled: true, frequency, tier },
    });
    this.options.onChange();
    this.start();
    await this.backUp();
  }

  /** Whether the service holds a file for the backup id; an id without a backup or without a public key has none */
  private async hasRemoteBackup(auth: ArchiveAuth) {
    try {
      const info = await getArchiveInfo(auth);
      return Boolean(await getArchiveFileInfo(info, await getArchiveReadHeaders(auth, info.cdn)));
    } catch (err) {
      if (err instanceof ArchiveError && (err.kind === 'notFound' || err.kind === 'unauthorized')) return false;
      throw err;
    }
  }

  /** Turns backups off; with `shouldDeleteBackup`, the backup on the service goes too */
  async disable(shouldDeleteBackup?: boolean) {
    this.stop();
    // A backup that is running ends before the settings change, or it would write its result over them
    await this.runPromise?.catch(() => undefined);

    const { account, keys } = await this.getKeys({ isPrimaryRequired: true });
    const { store } = this.options;
    if (shouldDeleteBackup) {
      const auth = await this.getAuth(account, keys, 'messages');
      // The credentials of SVR-B come from the backup, so they are fetched before it goes; the key leaves the enclaves
      // only once the backup is deleted, as a backup that stays on the service without its key cannot be opened. The
      // key is of no use without the backup, and a failure of the enclaves leaves a key that opens nothing.
      const svrbCredentials = await getSvrBCredentials(auth).catch((err) => this.options.onError(err));
      await deleteArchive(auth);
      if (svrbCredentials) await removeBackup(svrbCredentials).catch((err) => this.options.onError(err));
      await store.removeItem('svrbBackupData');
      await clearArchiveCredentials(store);
    }
    await this.options.client.updateAccount({
      backups: {
        ...account.backups, ...CLEARED_FAILURE, isEnabled: false, lastBackupAt: undefined, lastBackupSize: undefined,
      },
    });
    this.options.onChange();
  }

  async setFrequency(frequency: BackupFrequency) {
    const account = await this.getAccount();
    await this.options.client.updateAccount({ backups: { ...account.backups, frequency } });
    this.options.onChange();
  }

  /** Exports, validates and uploads a backup now; a refused size retries once with the last year of messages */
  async backUp(options: { signal?: AbortSignal; onProgress?(progress: BackupProgress): void } = {}) {
    if (this.isRunning) throw new Error('A backup is already running');
    this.isRunning = true;
    this.abortController = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, this.abortController.signal])
      : this.abortController.signal;
    this.currentProgress = undefined;
    this.options.onChange();
    const onProgress = (progress: BackupProgress) => {
      const previous = this.currentProgress;
      this.currentProgress = progress;
      // The upload reports every chunk; the settings show whole percents
      const isSame = previous?.step === progress.step
        && Math.floor((previous.progress ?? 0) * PERCENT) === Math.floor((progress.progress ?? 0) * PERCENT);
      if (!isSame) this.options.onChange();
      options.onProgress?.(progress);
    };

    try {
      const run = this.runBackup(signal, onProgress);
      this.runPromise = run;
      const result = await run;
      const account = await this.getAccount();
      await this.options.client.updateAccount({
        backups: {
          ...account.backups,
          ...CLEARED_FAILURE,
          lastBackupAt: getServerTime() * MS_PER_SECOND,
          lastRefreshAt: getServerTime() * MS_PER_SECOND,
          lastBackupSize: result.size,
        },
      });
      return result;
    } catch (err) {
      if (!signal.aborted) await this.noteFailure(err);
      throw err;
    } finally {
      this.runPromise = undefined;
      this.isRunning = false;
      this.abortController = undefined;
      this.currentProgress = undefined;
      this.options.onChange();
    }
  }

  /**
   * The backup as a file for the user to keep: the file that goes to the service, made by the same export. Backups
   * need not be turned on, but the account needs its recovery key, which opens the file.
   */
  async exportToFile(options: { signal?: AbortSignal; onProgress?(progress: BackupProgress): void } = {}) {
    if (this.isRunning) throw new Error('A backup is already running');
    const { account } = await this.getKeys();
    this.isRunning = true;
    this.options.onChange();
    try {
      const { file, stats } = await this.buildFile(
        account, account.backups?.messageDays, options.signal ?? new AbortController().signal, options.onProgress,
      );
      return { file, stats };
    } finally {
      this.isRunning = false;
      this.options.onChange();
    }
  }

  cancelBackup() {
    this.abortController?.abort();
  }

  /** Marks the backup as in use, so the service keeps it (`POST /v1/archives`) */
  async refresh() {
    const { account, keys } = await this.getKeys({ isPrimaryRequired: true });
    await refreshArchive(await this.getAuth(account, keys, 'messages'));
    await this.options.client.updateAccount({
      backups: {
        ...account.backups, lastRefreshAt: getServerTime() * MS_PER_SECOND, failureCount: undefined, nextAttemptAt: undefined,
      },
    });
    this.options.onChange();
  }

  /**
   * What the service holds, from requests that change nothing: the credential, the backup location and the first
   * byte of the file
   */
  async fetchRemoteStatus(): Promise<BackupRemoteStatus> {
    const { account, keys } = await this.getKeys();
    const auth = await this.getAuth(account, keys, 'messages');
    const tier = await this.getTier(account, keys, auth);
    const info = await getArchiveInfo(auth);
    const file = await getArchiveFileInfo(info, await getArchiveReadHeaders(auth, info.cdn));
    return {
      tier, hasBackup: Boolean(file), size: file?.size, modifiedAt: file?.modifiedAt,
    };
  }

  /** Starts the schedule, unless it runs: a check shortly after the start and then hourly */
  start() {
    if (this.timer) return;
    this.clearTimers();
    this.firstCheckTimer = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
  }

  /** Ends the schedule and a backup that is running */
  stop() {
    this.clearTimers();
    this.abortController?.abort();
  }

  private clearTimers() {
    clearTimeout(this.firstCheckTimer);
    clearInterval(this.timer);
    this.firstCheckTimer = undefined;
    this.timer = undefined;
  }

  /** Runs the backup that is due, or refreshes the one on the service when its day is up */
  private async check() {
    if (this.isRunning || !this.options.getIsConnected()) return;
    try {
      const account = await this.getAccount();
      const settings = account.backups;
      // A failure that only the user can fix, or a failure that waits out its backoff, stops the schedule meanwhile
      if (!settings?.isEnabled || settings.isStopped || !getIsPrimaryDevice(account)) return;

      const now = getServerTime() * MS_PER_SECOND;
      if (settings.nextAttemptAt && now < settings.nextAttemptAt) return;

      const interval = FREQUENCY_INTERVALS[settings.frequency ?? DEFAULT_BACKUP_FREQUENCY];
      if (interval !== undefined && now - (settings.lastBackupAt ?? 0) >= interval) {
        // `backUp` notes its failures
        await this.backUp();
      } else if (now - Math.max(settings.lastBackupAt ?? 0, settings.lastRefreshAt ?? 0) >= REFRESH_INTERVAL_MS) {
        await this.refresh().catch(async (err) => {
          await this.noteFailure(err);
          throw err;
        });
      }
    } catch (err) {
      this.options.onError(err);
    }
  }

  private async runBackup(signal: AbortSignal, onProgress?: (progress: BackupProgress) => void) {
    const { account, keys } = await this.getKeys({ isPrimaryRequired: true });
    const { store } = this.options;

    let messageDays = account.backups?.messageDays;
    for (;;) {
      signal.throwIfAborted();
      const auth = await this.getAuth(account, keys, 'messages', true);
      await ensureArchivePublicKey(auth);
      // The key of the file comes first: the enclaves take the key of the previous backup, and the file is made with
      // the token of this one
      const forwardSecrecy = await this.prepareForwardSecrecy(auth, keys);
      const { file, uncompressedLength, stats } = await this.buildFile(
        account, messageDays, signal, onProgress, forwardSecrecy,
      );

      signal.throwIfAborted();
      onProgress?.({ step: 'uploading', progress: 0 });
      try {
        await uploadArchive(auth, file, {
          signal,
          onProgress: (sent, total) => onProgress?.({ step: 'uploading', progress: total ? sent / total : 1 }),
        });
      } catch (err) {
        // Signal Android `BackupMessagesJob`: a file that is too large is made smaller once, by the oldest messages
        if (err instanceof ArchiveError && err.kind === 'tooLarge' && messageDays === undefined) {
          messageDays = TOO_LARGE_MESSAGE_DAYS;
          await this.options.client.updateAccount({ backups: { ...account.backups, messageDays } });
          continue;
        }
        throw err;
      }

      // The data of the next backup is valid for the file that went up (`BackupMessagesJob`)
      await store.setItem('svrbBackupData', forwardSecrecy.nextBackupData);
      await this.options.client.updateAccount({
        backups: { ...(await this.getAccount()).backups, uncompressedLength, messageDays },
      });
      return { size: file.length, stats } satisfies BackupResult;
    }
  }

  /**
   * Stores the key of the backup in SVR-B and gives the token for the file (Signal Android `BackupMessagesJob`). A device
   * that has no chain of its own looks at the backup on the service first: if it holds the header of a chain, the
   * chain continues from its key, and the enclaves are not overwritten before it is known that they hold nothing of
   * use. Only a backup that cannot be opened, or none, starts a new chain.
   */
  private async prepareForwardSecrecy(auth: ArchiveAuth, keys: ArchiveKeys) {
    const { store } = this.options;
    const credentials = await getSvrBCredentials(auth);
    let chain = await store.getItem('svrbBackupData');
    chain ??= await this.restoreChain(auth, keys, credentials) ?? createNewBackupChain(keys.backupKey);

    try {
      return await storeBackup(credentials, keys.backupKey, chain);
    } catch (err) {
      if (!(err instanceof SvrBError) || err.reason !== 'invalidData') throw err;
      // The state cannot be used: a new chain starts, and the next file is the first of it
      return storeBackup(credentials, keys.backupKey, createNewBackupChain(keys.backupKey));
    }
  }

  /** The chain of the backup on the service, from its header; `undefined` when there is none to continue */
  private async restoreChain(
    auth: ArchiveAuth, keys: ArchiveKeys, credentials: { username: string; password: string },
  ) {
    let metadata;
    try {
      const info = await getArchiveInfo(auth);
      const file = await getArchiveFileInfo(info, await getArchiveReadHeaders(auth, info.cdn));
      metadata = file && readForwardSecrecyMetadata(file.start);
    } catch (err) {
      // The service has no backup of this id yet
      if (err instanceof ArchiveError && err.kind === 'notFound') return undefined;
      throw err;
    }
    if (!metadata) return undefined;

    try {
      return (await restoreBackup(credentials, keys.backupKey, metadata)).nextBackupData;
    } catch (err) {
      // A chain that the enclaves cannot open anymore is not worth keeping, but one that could not be asked is
      if (err instanceof SvrBError && PERMANENT_SVRB_REASONS.includes(err.reason)) return undefined;
      throw err;
    }
  }

  /** Exports the local data to the encrypted backup file and validates it */
  private async buildFile(
    account: AccountRecord,
    messageDays: number | undefined,
    signal: AbortSignal,
    onProgress?: (progress: BackupProgress) => void,
    forwardSecrecy?: { forwardSecrecyToken: Uint8Array; metadata: Uint8Array },
  ) {
    const { store, db, appVersion } = this.options;
    const messageKeys = deriveMessageBackupKeys(
      getArchiveKeys(account).backupKey, account.aci, forwardSecrecy?.forwardSecrecyToken,
    );

    signal.throwIfAborted();
    onProgress?.({ step: 'exporting' });
    const exported = createBackupExport({
      store,
      db,
      account,
      appVersion,
      backupTier: account.backups?.tier,
      messageCutoffMs: messageDays !== undefined
        ? getServerTime() * MS_PER_SECOND - messageDays * MS_PER_DAY : undefined,
    });
    const { file, uncompressedLength } = await writeBackupFile(exported.info, exported.frames, messageKeys, {
      estimatedUncompressedLength: account.backups?.uncompressedLength,
      forwardSecrecyMetadata: forwardSecrecy?.metadata,
    });

    // The validator is the one that the clients of the service run on a restore
    signal.throwIfAborted();
    onProgress?.({ step: 'validating' });
    await validateBackupFile(file, messageKeys);
    return { file, uncompressedLength, stats: exported.stats };
  }

  /** The level of the credential for the tier of the account: the media credential knows it when there is one */
  private async getTier(account: AccountRecord, keys: ArchiveKeys, messagesAuth: ArchiveAuth) {
    if (!keys.mediaRootBackupKey) return messagesAuth.level;
    return (await this.getAuth(account, keys, 'media')).level;
  }

  private getAuth(
    account: AccountRecord, keys: ArchiveKeys, type: 'messages' | 'media', shouldReserveBackupId?: boolean,
  ) {
    return getArchiveAuth(this.options.store, account, keys, type, { shouldReserveBackupId });
  }

  /**
   * Notes why a run failed and when the schedule may try again: after a wait that doubles with each failure, or
   * the one that the service asked for. Failures that a retry cannot fix stop the schedule until the user acts.
   */
  private async noteFailure(err: unknown) {
    const account = await this.getAccount();
    const failureCount = (account.backups?.failureCount ?? 0) + 1;
    let delay = Math.min(BACKOFF_BASE_MS * 2 ** (failureCount - 1), BACKOFF_MAX_MS);
    if (err instanceof ArchiveError && err.retryAfterSeconds) {
      delay = Math.max(delay, err.retryAfterSeconds * MS_PER_SECOND);
    }

    const lastError = getFailureKind(err);
    const backups: BackupSettings = {
      ...account.backups,
      lastError,
      failureCount,
      nextAttemptAt: getServerTime() * MS_PER_SECOND + delay,
      isStopped: STOPPING_FAILURES.includes(lastError) || undefined,
    };
    await this.options.client.updateAccount({ backups });
  }

  private async getAccount() {
    const account = await this.options.store.getItem('account');
    if (!account) throw new Error('No account');
    return account;
  }

  private async getKeys({ isPrimaryRequired }: { isPrimaryRequired?: boolean } = {}) {
    const account = await this.getAccount();
    const reason = BackupService.getUnavailableReason(account);
    if (reason) throw new Error(`Backups are not available: ${reason}`);
    // A linked device could overwrite the backup of the phone, which a restore of the phone needs
    if (isPrimaryRequired && !getIsPrimaryDevice(account)) throw new NotPrimaryDeviceError();
    return { account, keys: getArchiveKeys(account) };
  }
}

/** The kind of a failure, which the settings explain: an `ArchiveError` kind, `validation`, or `failed` */
function getFailureKind(err: unknown) {
  if (err instanceof ArchiveError) return err.kind;
  if (err instanceof BackupValidationError || err instanceof BackupHeaderError) return 'validation';
  if (err instanceof SvrBError) return err.reason === 'rateLimited' ? 'rateLimited' : 'svrb';
  return 'failed';
}

/** The keys of the account's archive from its recovery key, which is the account entropy pool */
export function getArchiveKeys(
  { aci, accountEntropyPool, mediaRootBackupKey }:
  Pick<AccountRecord, 'aci' | 'accountEntropyPool' | 'mediaRootBackupKey'>,
): ArchiveKeys {
  return { aci, backupKey: wasm.AccountEntropyPool_DeriveBackupKey(accountEntropyPool!), mediaRootBackupKey };
}

export function getIsPrimaryDevice(account: AccountRecord) {
  return account.deviceId === SIGNAL_PRIMARY_DEVICE_ID;
}
