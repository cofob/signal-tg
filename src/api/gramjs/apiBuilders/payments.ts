import { Api as GramJs } from '../../../lib/gramjs';

import type {
  ApiPremiumPromo,
  ApiPremiumSection,
  ApiPremiumSubscriptionOption,
  ApiTypeCurrencyAmount,
} from '../../types';

import { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../../../config';
import { toJSNumber } from '../../../util/numbers';
import { buildApiMessageEntity } from './common';
import { buildApiDocument } from './messageContent';

export function buildApiPremiumPromo(promo: GramJs.help.PremiumPromo): ApiPremiumPromo {
  const {
    statusText, statusEntities, videos, videoSections, periodOptions,
  } = promo;

  return {
    statusText,
    statusEntities: statusEntities.map(buildApiMessageEntity),
    videoSections: videoSections as ApiPremiumSection[],
    videos: videos.map(buildApiDocument).filter(Boolean),
    options: periodOptions.map(buildApiPremiumSubscriptionOption),
  };
}

function buildApiPremiumSubscriptionOption(option: GramJs.PremiumSubscriptionOption): ApiPremiumSubscriptionOption {
  const {
    current, canPurchaseUpgrade, currency, amount, botUrl, months,
  } = option;

  return {
    isCurrent: current,
    canPurchaseUpgrade,
    currency,
    amount: toJSNumber(amount),
    botUrl,
    months,
  };
}

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
