// A running engine holds a shared lock named for its account slot, so that other contexts can tell that its stores are
// in use, such as the one that decrypts the stores of every slot before the passcode goes away
const LOCK_PREFIX = 'ts-signal-engine-';

type Hold = { isReleased: boolean; resolve?: NoneToVoidFunction };

let currentHold: Hold | undefined;

/** Marks the engine of this slot as running, until `releaseEngineLock` */
export function holdEngineLock(slot: number) {
  if (currentHold || !navigator.locks) return;

  const hold: Hold = { isReleased: false };
  currentHold = hold;
  void navigator.locks.request(`${LOCK_PREFIX}${slot}`, { mode: 'shared' }, () => new Promise<void>((resolve) => {
    if (hold.isReleased) {
      resolve();
      return;
    }
    hold.resolve = resolve;
  }));
}

/** Frees the lock, so that an engine started again in the same worker takes it anew */
export function releaseEngineLock() {
  if (!currentHold) return;

  currentHold.isReleased = true;
  currentHold.resolve?.();
  currentHold = undefined;
}

/** The slots whose engine is running in some context of this browser; `undefined` where the browser cannot tell */
export async function getRunningEngineSlots() {
  if (!navigator.locks?.query) return undefined;

  const { held = [] } = await navigator.locks.query();
  return held
    .map(({ name }) => name)
    .filter((name): name is string => Boolean(name?.startsWith(LOCK_PREFIX)))
    .map((name) => Number(name.slice(LOCK_PREFIX.length)));
}
