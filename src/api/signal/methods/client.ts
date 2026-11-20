import { stopClient } from '../client';

/**
 * Logging out forgets the account and local messages; the phone keeps listing the device until it unlinks it.
 * `noLogOut` only closes the connections.
 */
export async function destroy(noLogOut = false) {
  await stopClient(!noLogOut);
}

export function disconnect() {
  void stopClient(false);
}
