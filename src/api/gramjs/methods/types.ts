import type * as signalAuthMethods from '../../signal/methods/auth';
import type * as signalStoryMethods from '../../signal/methods/stories';
import type * as methods from './index';

// Signal authorization and story methods replace the GramJS ones and add Signal steps such as the captcha and
// story distribution lists
export type Methods = Omit<typeof methods, keyof typeof signalAuthMethods | keyof typeof signalStoryMethods>
  & typeof signalAuthMethods & typeof signalStoryMethods;
export type MethodArgs<N extends keyof Methods> = Parameters<Methods[N]>;
export type MethodResponse<N extends keyof Methods> = ReturnType<Methods[N]>;
