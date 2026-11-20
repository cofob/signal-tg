import initModule from './generated/signal_wasm';

export * as wasm from './generated/signal_wasm';

let initPromise: Promise<unknown> | undefined;

/** Loads the libsignal WebAssembly module; every export of `wasm` requires it */
export function initSignalWasm() {
  initPromise ??= initModule();
  return initPromise;
}
