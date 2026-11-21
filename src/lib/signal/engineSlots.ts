import { ACCOUNT_SLOT, getAccountSlots } from '../../util/multiaccount';

// The IndexedDB names of `SignalStore` and `MessageDb` with the suffix of `getEngineStoreName`
const ENGINE_DB_NAME_REGEXP = /^ts-signal(?:-messages)?(?:-(\d+))?$/;

/**
 * The account slots whose engine data may be in this browser. The slots come from the stored sessions, which are not
 * readable while the sessions are locked, and from the databases that the browser lists.
 */
export async function getEngineSlots() {
  const slots = new Set([ACCOUNT_SLOT || 1, ...getSessionSlots()]);
  // Not available in every browser; the slots of the sessions are the fallback
  const databases = await indexedDB.databases?.().catch(() => undefined);
  databases?.forEach(({ name }) => {
    const match = name?.match(ENGINE_DB_NAME_REGEXP);
    if (match) slots.add(Number(match[1] ?? 1));
  });
  return slots;
}

/** The stored sessions are in `localStorage`, which a worker does not have; there the databases tell the slots */
function getSessionSlots() {
  try {
    return getAccountSlots();
  } catch (err) {
    return [];
  }
}
