import type * as signalMethods from '../../signal/methods/index';
import type * as methods from './index';

// Signal methods without a GramJS counterpart join the GramJS ones until plan stage 3 removes GramJS
export type Methods = typeof methods & Omit<typeof signalMethods, keyof typeof methods>;
export type MethodArgs<N extends keyof Methods> = Parameters<Methods[N]>;
export type MethodResponse<N extends keyof Methods> = ReturnType<Methods[N]>;
