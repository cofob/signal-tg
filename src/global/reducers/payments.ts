import type {
  ApiTypeCurrencyAmount,
} from '../../api/types';
import type {
  GlobalState,
} from '../types';

import { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../../config';

export function updateStarsBalance<T extends GlobalState>(
  global: T, balance: ApiTypeCurrencyAmount,
): T {
  if (balance.currency === STARS_CURRENCY_CODE) {
    return {
      ...global,
      stars: {
        ...global.stars,
        balance,
      },
    };
  }

  if (balance.currency === TON_CURRENCY_CODE) {
    return {
      ...global,
      ton: {
        ...global.ton,
        balance,
      },
    };
  }

  return global;
}
