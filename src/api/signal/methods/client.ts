import { reconnectClient, stopClient } from '../client';

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

/** Replaces the chat connection at once, such as after the computer slept or the network changed */
export function reconnectNow() {
  reconnectClient();
}
