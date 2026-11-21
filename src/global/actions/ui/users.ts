import type { ActionReturnType } from '../../types';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { addTabStateResetterAction } from '../../helpers/meta';
import { addActionHandler } from '../../index';
import { closeNewContactDialog } from '../../reducers';
import { updateTabState } from '../../reducers/tabs';
import { selectIsCurrentUserFrozen } from '../../selectors';

addActionHandler('openAddContactDialog', (global, actions, payload): ActionReturnType => {
  const { userId, tabId = getCurrentTabId() } = payload;

  if (selectIsCurrentUserFrozen(global)) {
    actions.openFrozenAccountModal({ tabId });
    return global;
  }

  return updateTabState(global, {
    newContact: { userId },
  }, tabId);
});

addActionHandler('openNewContactDialog', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  if (selectIsCurrentUserFrozen(global)) {
    actions.openFrozenAccountModal({ tabId });
    return global;
  }

  return updateTabState(global, {
    newContact: {
      isByPhoneNumber: true,
    },
  }, tabId);
});

addActionHandler('closeNewContactDialog', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return closeNewContactDialog(global, tabId);
});

addActionHandler('closeSuggestedStatusModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    suggestedStatusModal: undefined,
  }, tabId);
});

addActionHandler('openDisableSharingAboutModal', (global, actions, payload): ActionReturnType => {
  const { userId, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    disableSharingAboutModal: { userId },
  }, tabId);
});

addTabStateResetterAction('closeDisableSharingAboutModal', 'disableSharingAboutModal');

addActionHandler('openRankModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId(), ...rest } = payload;

  return updateTabState(global, {
    rankModal: rest,
  }, tabId);
});

addTabStateResetterAction('closeRankModal', 'rankModal');

addActionHandler('openEditRankModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId(), ...rest } = payload;

  return updateTabState(global, {
    editRankModal: rest,
  }, tabId);
});

addTabStateResetterAction('closeEditRankModal', 'editRankModal');

addTabStateResetterAction('closeSafetyNumberModal', 'safetyNumberModal');

addActionHandler('openSafetyNumberChangeModal', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, userIds, tabId = getCurrentTabId() } = payload;
  return updateTabState(global, { safetyNumberChangeModal: { chatId, messageId, userIds } }, tabId);
});
addTabStateResetterAction('closeSafetyNumberChangeModal', 'safetyNumberChangeModal');

addActionHandler('openMessageDetailsModal', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;
  actions.loadMessageDetails({ chatId, messageId, tabId });
  return updateTabState(global, { messageDetailsModal: { chatId, messageId } }, tabId);
});
addTabStateResetterAction('closeMessageDetailsModal', 'messageDetailsModal');

addTabStateResetterAction('closeRecoveryKeyModal', 'recoveryKeyModal');

addActionHandler('openPhoneNumberLookupModal', (global, actions, payload): ActionReturnType => {
  const { phoneNumber, tabId = getCurrentTabId() } = payload;
  return updateTabState(global, { phoneNumberLookupModal: { phoneNumber } }, tabId);
});

addTabStateResetterAction('closePhoneNumberLookupModal', 'phoneNumberLookupModal');
