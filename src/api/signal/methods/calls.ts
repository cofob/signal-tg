import { processor } from '../engine';
import { buildCallLog } from '../updaters/calls';

export function fetchCallLog() {
  return buildCallLog();
}

/** Clears the call log here and on our other devices */
export async function clearCallLog() {
  await processor.clearCallLog();
  return true;
}
