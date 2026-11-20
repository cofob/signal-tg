import type {
  ApiStarsAmount,
  ApiTypeCurrencyAmount,
} from '../../api/types';

import { STARS_CURRENCY_CODE } from '../../config';

export function buildStarsAmount(amount: number): ApiStarsAmount {
  return { currency: STARS_CURRENCY_CODE, amount, nanos: 0 };
}

export function areCurrencyAmountsEqual(one?: ApiTypeCurrencyAmount, two?: ApiTypeCurrencyAmount) {
  if (one?.currency === STARS_CURRENCY_CODE && two?.currency === STARS_CURRENCY_CODE) {
    return one.amount === two.amount && one.nanos === two.nanos;
  }

  return one?.currency === two?.currency && one?.amount === two?.amount;
}
