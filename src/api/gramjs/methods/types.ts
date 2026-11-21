import type * as signalAuthMethods from '../../signal/methods/auth';
import type * as signalMethods from '../../signal/methods/index';
import type * as signalStoryMethods from '../../signal/methods/stories';
import type * as methods from './index';

// Signal authorization and story methods replace the GramJS ones and add Signal steps such as the captcha and
// story distribution lists; other Signal methods without a GramJS counterpart join the GramJS ones until plan
// stage 3 removes GramJS
type SignalOverrides = typeof signalAuthMethods & typeof signalStoryMethods;
type GramJsAndOverrides = Omit<typeof methods, keyof SignalOverrides> & SignalOverrides;
export type Methods = GramJsAndOverrides & Omit<typeof signalMethods, keyof GramJsAndOverrides>;
export type MethodArgs<N extends keyof Methods> = Parameters<Methods[N]>;
export type MethodResponse<N extends keyof Methods> = ReturnType<Methods[N]>;
