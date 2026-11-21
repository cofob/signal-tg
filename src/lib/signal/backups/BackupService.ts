import type MessageDb from '../db/MessageDb';
import type SignalClient from '../SignalClient';
import type SignalStore from '../store/SignalStore';
import type { AccountRecord, BackupFrequency, BackupSettings } from '../store/SignalStore';
import type { ArchiveAuth, ArchiveKeys } from './archiveApi';
import type { BackupExportStats } from './exportBackup';

import { SIGNAL_PRIMARY_DEVICE_ID } from '../config';
import { getServerTime } from '../../../util/serverTime';
import { wasm } from '../wasm';
import {
  ArchiveError,
  deleteArchive,
  ensureArchivePublicKey,
  getArchiveAuth,
  getArchiveFileInfo,
  getArchiveInfo,
  getArchiveReadHeaders,
  refreshArchive,
  uploadArchive,
} from './archiveApi';
import { deriveMessageBackupKeys } from './backupStream';
import { writeBackupFile } from './backupWriter';
import { createBackupExport } from './exportBackup';
import { validateBackupFile } from './validateBackup';

export type BackupUnavailableReason =
  // The account has no account entropy pool, which the keys of a backup come from: a registration that a PIN restored
  | 'noRecoveryKey'
  // The backup header carries a random root key that registration generates and linking brings
  | 'noMediaRootKey';

export type BackupStep = 'exporting' | 'validating' | 'uploading';

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
// Signal Android `BackupMessagesJob.TOO_LARGE_MESSAGE_CUTTOFF_DURATION`
const TOO_LARGE_MESSAGE_DAYS = 365;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
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
  async enable(frequency: BackupFrequency = DEFAULT_BACKUP_FREQUENCY) {
    const { account, keys } = await this.getKeys();
    const messagesAuth = await this.getAuth(account, keys, 'messages');
    const tier = await this.getTier(account, keys, messagesAuth);
    await this.options.client.updateAccount({
      backups: { ...account.backups, isEnabled: true, frequency, tier, lastError: undefined },
    });
    this.options.onChange();
    this.start();
    await this.backUp();
  }

  /** Turns backups off; with `shouldDeleteBackup`, the backup on the service goes too */
  async disable(shouldDeleteBackup?: boolean) {
    this.stop();
    const { account, keys } = await this.getKeys();
    if (shouldDeleteBackup) {
      const auth = await this.getAuth(account, keys, 'messages');
      await deleteArchive(auth);
    }
    await this.options.client.updateAccount({
      backups: { ...account.backups, isEnabled: false, lastBackupAt: undefined, lastBackupSize: undefined },
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
      const result = await this.runBackup(signal, onProgress);
      const account = await this.getAccount();
      await this.options.client.updateAccount({
        backups: {
          ...account.backups,
          lastBackupAt: getServerTime() * MS_PER_SECOND,
          lastRefreshAt: getServerTime() * MS_PER_SECOND,
          lastBackupSize: result.size,
          lastError: undefined,
        },
      });
      return result;
    } catch (err) {
      if (!signal.aborted) await this.noteFailure(err);
      throw err;
    } finally {
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
    const { account } = await this.getKeys();
    const { file, stats } = await this.buildFile(
      account, account.backups?.messageDays, options.signal ?? new AbortController().signal, options.onProgress,
    );
    return { file, stats };
  }

  cancelBackup() {
    this.abortController?.abort();
  }

  /** Marks the backup as in use, so the service keeps it (`POST /v1/archives`) */
  async refresh() {
    const { account, keys } = await this.getKeys();
    await refreshArchive(await this.getAuth(account, keys, 'messages'));
    await this.options.client.updateAccount({
      backups: { ...account.backups, lastRefreshAt: getServerTime() * MS_PER_SECOND },
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

  /** Starts the schedule: a check shortly after the start and then hourly */
  start() {
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
      if (!settings?.isEnabled) return;

      const interval = FREQUENCY_INTERVALS[settings.frequency ?? DEFAULT_BACKUP_FREQUENCY];
      const now = getServerTime() * MS_PER_SECOND;
      if (interval !== undefined && now - (settings.lastBackupAt ?? 0) >= interval) {
        await this.backUp();
      } else if (now - Math.max(settings.lastBackupAt ?? 0, settings.lastRefreshAt ?? 0) >= REFRESH_INTERVAL_MS) {
        await this.refresh();
      }
    } catch (err) {
      this.options.onError(err);
    }
  }

  private async runBackup(signal: AbortSignal, onProgress?: (progress: BackupProgress) => void) {
    const { account, keys } = await this.getKeys();
    const { store } = this.options;

    let messageDays = account.backups?.messageDays;
    for (;;) {
      const { file, uncompressedLength, stats } = await this.buildFile(account, messageDays, signal, onProgress);

      signal.throwIfAborted();
      onProgress?.({ step: 'uploading', progress: 0 });
      try {
        const auth = await this.getAuth(account, keys, 'messages');
        await ensureArchivePublicKey(store, keys, auth);
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

      await this.options.client.updateAccount({
        backups: { ...(await this.getAccount()).backups, uncompressedLength, messageDays },
      });
      return { size: file.length, stats } satisfies BackupResult;
    }
  }

  /** Exports the local data to the encrypted backup file and validates it */
  private async buildFile(
    account: AccountRecord,
    messageDays: number | undefined,
    signal: AbortSignal,
    onProgress?: (progress: BackupProgress) => void,
  ) {
    const { store, db, appVersion } = this.options;
    const messageKeys = deriveMessageBackupKeys(getArchiveKeys(account).backupKey, account.aci);

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

  private getAuth(account: AccountRecord, keys: ArchiveKeys, type: 'messages' | 'media') {
    return getArchiveAuth(this.options.store, account, keys, type);
  }

  private async noteFailure(err: unknown) {
    const message = err instanceof ArchiveError ? err.kind : 'failed';
    const account = await this.getAccount();
    const backups: BackupSettings = { ...account.backups, lastError: message };
    await this.options.client.updateAccount({ backups });
  }

  private async getAccount() {
    const account = await this.options.store.getItem('account');
    if (!account) throw new Error('No account');
    return account;
  }

  private async getKeys() {
    const account = await this.getAccount();
    const reason = BackupService.getUnavailableReason(account);
    if (reason) throw new Error(`Backups are not available: ${reason}`);
    return { account, keys: getArchiveKeys(account) };
  }
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
