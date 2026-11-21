import type { GlobalState, TabState, WithTabId } from '../types';

import { getCurrentTabId } from '../../util/establishMultitabRole';
import { updateTabState } from '../reducers/tabs';
import { addActionHandler, type TabStateActionNames } from '..';

export function addTabStateResetterAction<ActionName extends TabStateActionNames>(
  name: ActionName, key: keyof TabState,
) {
  // Relating the handler to every tab state action is too expensive for the type checker, and a resetter reads only
  // `tabId` from the payload
  (addActionHandler as AnyFunction)(name, (global: GlobalState, actions: unknown, payload?: WithTabId) => {
    const { tabId = getCurrentTabId() } = payload || {};

    return updateTabState(global, {
      [key]: undefined,
    }, tabId);
  });
}
