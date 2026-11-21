import type { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../../config';

export type ApiTypeCurrencyAmount = ApiStarsAmount | ApiTonAmount;

export interface ApiStarsAmount {
  currency: typeof STARS_CURRENCY_CODE;
  amount: number;
  nanos: number;
}

interface ApiTonAmount {
  currency: typeof TON_CURRENCY_CODE;
  // Nanotons
  amount: bigint;
}

export interface ApiStarsRating {
  level: number;
  currentLevelStars: number;
  stars: number;
  nextLevelStars?: number;
}
