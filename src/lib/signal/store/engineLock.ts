// A running engine holds a shared lock named for its account slot, so that other contexts can tell that its stores are
// in use, such as the one that decrypts the stores of every slot before the passcode goes away
const LOCK_PREFIX = 'ts-signal-engine-';

let isHeld = false;
let resolveLock: NoneToVoidFunction | undefined;
let isReleaseRequested = false;

/** Marks the engine of this slot as running, until `releaseEngineLock` */
export function holdEngineLock(slot: number) {
  if (isHeld || !navigator.locks) return;

  isHeld = true;
  isReleaseRequested = false;
  void navigator.locks.request(`${LOCK_PREFIX}${slot}`, { mode: 'shared' }, () => new Promise<void>((resolve) => {
    if (isReleaseRequested) {
      resolve();
      return;
    }
    resolveLock = resolve;
  })).finally(() => {
    isHeld = false;
    resolveLock = undefined;
  });
}

export function releaseEngineLock() {
  isReleaseRequested = true;
  resolveLock?.();
}

/** The slots whose engine is running in some context of this browser */
export async function getRunningEngineSlots() {
  if (!navigator.locks?.query) return [];

  const { held = [] } = await navigator.locks.query();
  return held
    .map(({ name }) => name)
    .filter((name): name is string => Boolean(name?.startsWith(LOCK_PREFIX)))
    .map((name) => Number(name.slice(LOCK_PREFIX.length)));
}
