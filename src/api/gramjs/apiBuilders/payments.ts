import { Api as GramJs } from '../../../lib/gramjs';

import type { ApiTypeCurrencyAmount } from '../../types';

import { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../../../config';
import { toJSNumber } from '../../../util/numbers';

export function buildApiCurrencyAmount(amount: GramJs.TypeStarsAmount): ApiTypeCurrencyAmount {
  if (amount instanceof GramJs.StarsAmount) {
    return {
      currency: STARS_CURRENCY_CODE,
      amount: toJSNumber(amount.amount),
      nanos: amount.nanos,
    };
  }

  if (amount instanceof GramJs.StarsTonAmount) {
    return {
      currency: TON_CURRENCY_CODE,
      amount: amount.amount,
    };
  }

  const _exhaustive: never = amount;
  return _exhaustive;
}
