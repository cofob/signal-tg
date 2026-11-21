import { getEngineStoreName } from './engineStoreName';

const ENGINE_LOCK_NAME = 'telesignal-engine';

let releaseHeldLock: NoneToVoidFunction | undefined;

/**
 * Takes the exclusive lock on the engine's stores of this worker's account slot, which the engine holds while it runs. Both
 * frontends (Web A at `/a/`, Web K at `/k/`) start the engine through `startClient`, so only one engine of the origin
 * opens the stores at a time (`store/engineLock.ts` only marks a running engine for other contexts). A new start takes the lock away from the engine that holds it, as the frontend that the
 * user opened last becomes the active one; the engine that lost the lock stops through `onLost`.
 */
export function acquireEngineOwnership(onLost: NoneToVoidFunction) {
  releaseEngineOwnership();
  // Contexts without Web Locks, such as the tests' DOM, run the engine without the lock
  if (!navigator.locks) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let release: NoneToVoidFunction;
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });

    navigator.locks.request(getEngineStoreName(ENGINE_LOCK_NAME), { steal: true }, () => {
      releaseHeldLock = release;
      resolve();
      return held;
    }).catch(() => {
      // The request rejects only when another start took the lock
      if (releaseHeldLock !== release) return;
      releaseHeldLock = undefined;
      onLost();
    });
  });
}

export function releaseEngineOwnership() {
  releaseHeldLock?.();
  releaseHeldLock = undefined;
}
