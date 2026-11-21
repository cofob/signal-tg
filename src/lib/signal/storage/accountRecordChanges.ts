/**
 * Fields of the storage service account record that this device changed. The new values are on the account
 * (`usernameLink`, `isPhoneNumberShared`, `isPhoneNumberUnlisted`) and on our private conversation (`username`);
 * the storage service writer subscribes and uploads an account record with them.
 */
export type AccountRecordField = 'username' | 'usernameLink' | 'phoneNumberSharingMode' | 'unlistedPhoneNumber';

type Listener = (fields: AccountRecordField[]) => void;

const listeners = new Set<Listener>();

/** Returns the unsubscribe function */
export function subscribeToAccountRecordChanges(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyAccountRecordChange(fields: AccountRecordField[]) {
  listeners.forEach((listener) => listener(fields));
}
