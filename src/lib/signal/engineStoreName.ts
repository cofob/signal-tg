import { ACCOUNT_SLOT } from '../../util/multiaccount';

/**
 * Names a store of the engine's browser storage for an account slot. The first slot keeps the base name, so the data
 * of a browser that never used several accounts stays where it is; the other slots get a `-<slot>` suffix.
 * A worker takes its slot from its name, see `ACCOUNT_SLOT`.
 */
export function getEngineStoreName(base: string, slot = ACCOUNT_SLOT) {
  return slot && slot !== 1 ? `${base}-${slot}` : base;
}
