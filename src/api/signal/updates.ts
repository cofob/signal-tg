import type { ApiUpdate, OnApiUpdate } from '../types';

let onUpdate: OnApiUpdate | undefined;

export function initUpdates(callback: OnApiUpdate) {
  onUpdate = callback;
}

export function sendApiUpdate(update: ApiUpdate) {
  onUpdate?.(update);
}
