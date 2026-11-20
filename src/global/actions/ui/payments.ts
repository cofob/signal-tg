import type { ActionReturnType } from '../../types';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { addActionHandler } from '../../index';
import { updateTabState } from '../../reducers/tabs';

addActionHandler('openPaymentMessageConfirmDialogOpen', (global, actions, payload): ActionReturnType => {
  const { dialogKey, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    paymentMessageConfirmDialogKey: dialogKey,
  }, tabId);
});

addActionHandler('closePaymentMessageConfirmDialogOpen', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    paymentMessageConfirmDialogKey: undefined,
  }, tabId);
});
