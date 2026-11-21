import type { MessageBackupKeys } from './backupStream';

import { wasm } from '../wasm';
import { readBackupFrames } from './backupStream';

// libsignal `Purpose`
export const BACKUP_PURPOSE_REMOTE = 1;

const MAX_REPORTED_ERRORS = 10;

/** A backup that libsignal's validator rejects; `messages` are what it reports, one per rejected frame */
export class BackupValidationError extends Error {
  constructor(readonly messages: string[]) {
    super(`Backup validation failed: ${messages.join('; ')}`);
  }
}

/**
 * Checks an encrypted backup the way libsignal's `MessageBackupValidator` does (Signal Desktop `validateBackup` in
 * `ts/services/backups/validator.preload.ts`): the MAC and the encryption are read as an import would read them, and
 * every frame goes through the `message-backup` validator, which also checks the ordering rules and that references
 * resolve. Throws `BackupValidationError` with the errors of the rejected frames.
 */
export async function validateBackupFile(
  archive: Uint8Array<ArrayBuffer>, keys: MessageBackupKeys, purpose = BACKUP_PURPOSE_REMOTE,
) {
  let validator: wasm.OnlineBackupValidator | undefined;
  const errors: string[] = [];

  try {
    for await (const frame of readBackupFrames(archive, keys)) {
      if (!validator) {
        // The first frame is the `BackupInfo` header
        validator = wasm.OnlineBackupValidator_New(frame, purpose);
        continue;
      }
      try {
        wasm.OnlineBackupValidator_AddFrame(validator, frame);
      } catch (err) {
        if (errors.length < MAX_REPORTED_ERRORS) errors.push(getMessage(err));
      }
    }
    if (!validator) throw new BackupValidationError(['The backup has no header']);
    wasm.OnlineBackupValidator_Finalize(validator);
  } catch (err) {
    if (err instanceof BackupValidationError) throw err;
    // The finalization reports what is missing, such as the account data, once the frames themselves are fine
    errors.push(getMessage(err));
    throw new BackupValidationError(errors);
  }

  if (errors.length) throw new BackupValidationError(errors);
}

function getMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
