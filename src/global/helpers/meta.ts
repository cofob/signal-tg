import type { ActionReturnType, GlobalState, TabState } from '../types';

import { getCurrentTabId } from '../../util/establishMultitabRole';
import { updateTabState } from '../reducers/tabs';
import { addActionHandler, type TabStateActionNames } from '..';

type TabStateResetterHandler = (
  global: GlobalState, actions: unknown, payload?: { tabId?: number },
) => ActionReturnType;

// Inferring `addActionHandler` over the union of all tab state actions makes type checking take minutes
const addTabStateActionHandler = addActionHandler as unknown as (
  name: TabStateActionNames, handler: TabStateResetterHandler,
) => void;

export function addTabStateResetterAction(name: TabStateActionNames, key: keyof TabState) {
  addTabStateActionHandler(name, (global, actions, payload): ActionReturnType => {
    const { tabId = getCurrentTabId() } = payload || {};

    return updateTabState(global, {
      [key]: undefined,
    }, tabId);
  });
}
