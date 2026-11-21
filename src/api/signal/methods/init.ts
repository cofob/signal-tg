import type { ApiInitialArgs, ApiOnProgress, OnApiUpdate } from '../../types';
import type { MethodArgs, MethodResponse, Methods } from './types';

import { DEBUG } from '../../../config';
import { startClient } from '../client';
import { initUpdates } from '../updates';
import * as methods from './index';

const SIGNAL_METHODS: Partial<Methods> = methods;

export function initApi(onUpdate: OnApiUpdate, initialArgs: ApiInitialArgs) {
  initUpdates(onUpdate);
  return startClient(initialArgs);
}

/** Calls a Signal method; a method the engine does not implement returns `undefined` */
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
