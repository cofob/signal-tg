import type * as signalAuthMethods from '../../signal/methods/auth';
import type * as methods from './index';

// Signal authorization methods replace the GramJS ones and add Signal steps such as the captcha
export type Methods = Omit<typeof methods, keyof typeof signalAuthMethods> & typeof signalAuthMethods;
export type MethodArgs<N extends keyof Methods> = Parameters<Methods[N]>;
export type MethodResponse<N extends keyof Methods> = ReturnType<Methods[N]>;
