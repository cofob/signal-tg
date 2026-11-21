import type { MethodArgs, MethodResponse, Methods } from '../../gramjs/methods/types';
import type { ApiInitialArgs, ApiOnProgress, OnApiUpdate } from '../../types';

import { DEBUG } from '../../../config';
import { startClient } from '../client';
import { initUpdates } from '../updates';
import * as methods from './index';

// Each Signal method keeps the name and signature of the GramJS method it replaces
const SIGNAL_METHODS: Partial<Methods> = methods;

// The worker passes the GramJS local cache as the third argument; Signal keeps its state in IndexedDB
export function initApi(onUpdate: OnApiUpdate, initialArgs: ApiInitialArgs, _initialLocalDb?: unknown) {
  initUpdates(onUpdate);
  return startClient(initialArgs);
}

/** Calls a Signal method; methods without a Signal counterpart return `undefined` */
export function callApi<T extends keyof Methods>(fnName: T, ...args: MethodArgs<T>): MethodResponse<T> {
  const method = SIGNAL_METHODS[fnName] as ((...methodArgs: MethodArgs<T>) => MethodResponse<T>) | undefined;
  if (!method) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.debug('[signal] Unsupported API method', fnName);
    }
    return undefined as MethodResponse<T>;
  }
  return method(...args);
}

export function cancelApiProgress(progressCallback: ApiOnProgress) {
  progressCallback.isCanceled = true;
}
