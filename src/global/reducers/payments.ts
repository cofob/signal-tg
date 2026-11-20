import type {
  ApiStarsSubscription,
  ApiStarsTransaction,
  ApiTypeCurrencyAmount,
} from '../../api/types';
import type {
  StarsSubscriptions,
  StarsTransactionType,
} from '../../types';
import type {
  GlobalState, TabArgs, TabState,
} from '../types';

import { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../../config';
import { getCurrentTabId } from '../../util/establishMultitabRole';
import { selectStarsPayment } from '../selectors';
import { updateTabState } from './tabs';

export function updateStarsPayment<T extends GlobalState>(
  global: T, update: Partial<TabState['starsPayment']>,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
): T {
  const starPayment = selectStarsPayment(global, tabId);
  if (!starPayment) {
    return global;
  }

  return updateTabState(global, {
    starsPayment: {
      ...starPayment,
      ...update,
    },
  }, tabId);
}

export function clearStarPayment<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
): T {
  return updateTabState(global, {
    starsPayment: {},
  }, tabId);
}

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

export function appendStarsTransactions<T extends GlobalState>(
  global: T,
  type: StarsTransactionType,
  transactions: ApiStarsTransaction[],
  nextOffset?: string,
  isTon?: boolean,
): T {
  if (isTon) {
    const history = global.ton?.history;
    if (!history) {
      return global;
    }

    const newTypeObject = {
      transactions: (history[type]?.transactions || []).concat(transactions),
      nextOffset,
    };

    return {
      ...global,
      ton: {
        ...global.ton,
        history: {
          ...history,
          [type]: newTypeObject,
        },
      },
    };
  }

  const history = global.stars?.history;
  if (!history) {
    return global;
  }

  const newTypeObject = {
    transactions: (history[type]?.transactions || []).concat(transactions),
    nextOffset,
  };

  return {
    ...global,
    stars: {
      ...global.stars,
      history: {
        ...history,
        [type]: newTypeObject,
      },
    },
  };
}

export function appendStarsSubscriptions<T extends GlobalState>(
  global: T,
  subscriptions: ApiStarsSubscription[],
  nextOffset?: string,
): T {
  if (!global.stars) {
    return global;
  }

  const newObject = {
    list: (global.stars.subscriptions?.list || []).concat(subscriptions),
    nextOffset,
  } satisfies StarsSubscriptions;

  return {
    ...global,
    stars: {
      ...global.stars,
      subscriptions: newObject,
    },
  };
}

export function updateStarsSubscriptionLoading<T extends GlobalState>(
  global: T, isLoading: boolean,
): T {
  const subscriptions = global.stars?.subscriptions;
  if (!subscriptions) {
    return global;
  }

  return {
    ...global,
    stars: {
      ...global.stars,
      subscriptions: {
        ...subscriptions,
        isLoading,
      },
    },
  };
}

export function openStarsTransactionModal<T extends GlobalState>(
  global: T, transaction: ApiStarsTransaction, ...[tabId = getCurrentTabId()]: TabArgs<T>
): T {
  return updateTabState(global, {
    starsTransactionModal: {
      transaction,
    },
  }, tabId);
}
