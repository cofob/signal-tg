import { processor } from '../engine';
import { buildCallLog } from '../updaters/calls';

export function fetchCallLog() {
  return buildCallLog();
}

/** The calls list was opened: the calls count as seen, here and on our other devices */
export async function markCallLogSeen() {
  await processor.markCallLogSeen();
  return true;
}

/** Clears the call log here and on our other devices */
export async function clearCallLog() {
  await processor.clearCallLog();
  return true;
}
