import type * as signalAuthMethods from '../../signal/methods/auth';
import type * as signalMethods from '../../signal/methods/index';
import type * as methods from './index';

// Signal authorization methods replace the GramJS ones and add Signal steps such as the captcha; other Signal
// methods without a GramJS counterpart join the GramJS ones until plan stage 3 removes GramJS
type GramJsAndAuthMethods = Omit<typeof methods, keyof typeof signalAuthMethods> & typeof signalAuthMethods;
export type Methods = GramJsAndAuthMethods & Omit<typeof signalMethods, keyof GramJsAndAuthMethods>;
export type MethodArgs<N extends keyof Methods> = Parameters<Methods[N]>;
export type MethodResponse<N extends keyof Methods> = ReturnType<Methods[N]>;
