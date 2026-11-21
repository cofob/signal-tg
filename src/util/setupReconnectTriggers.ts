import { callApi } from '../api/gramjs';
import { isCurrentTabMaster } from './establishMultitabRole';

const SLEEP_CHECK_INTERVAL_MS = 10 * 1000;
// Timers that a hidden tab runs late are throttled to once a minute, so only a longer delay shows that the computer
// slept
const SLEEP_DRIFT_THRESHOLD_MS = 90 * 1000;

let isSetUp = false;

/**
 * Asks the engine to reconnect at once when the network comes back and when the computer wakes up, instead of waiting
 * for the keepalive or the backoff. The master tab runs the engine, so only it asks.
 */
export default function setupReconnectTriggers() {
  if (isSetUp) return;
  isSetUp = true;

  window.addEventListener('online', reconnect);

  // Timers do not run while the computer sleeps, so the first one after waking comes long after it was due
  let lastCheckAt = Date.now();
  setInterval(() => {
    const now = Date.now();
    const drift = now - lastCheckAt - SLEEP_CHECK_INTERVAL_MS;
    lastCheckAt = now;
    if (drift > SLEEP_DRIFT_THRESHOLD_MS) reconnect();
  }, SLEEP_CHECK_INTERVAL_MS);
}

function reconnect() {
  if (isCurrentTabMaster()) void callApi('reconnectNow');
}
