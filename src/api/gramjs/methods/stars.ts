import { Api as GramJs } from '../../../lib/gramjs';

import {
  buildApiCurrencyAmount,
  buildApiStarsGiveawayOptions,
} from '../apiBuilders/payments';
import { invokeRequest } from './client';

export async function fetchStarsGiveawayOptions() {
  const result = await invokeRequest(new GramJs.payments.GetStarsGiveawayOptions());

  if (!result) {
    return undefined;
  }

  return result.map(buildApiStarsGiveawayOptions);
}

export async function fetchStarsStatus({
  isTon,
}: {
  isTon?: boolean;
} = {}) {
  const result = await invokeRequest(new GramJs.payments.GetStarsStatus({
    peer: new GramJs.InputPeerSelf(),
    ton: isTon || undefined,
  }));

  if (!result) {
    return undefined;
  }

  const balance = buildApiCurrencyAmount(result.balance);
  if (!balance) {
    return undefined;
  }

  return balance;
}
