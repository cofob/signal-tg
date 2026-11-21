import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { callApi } from '../../../api';
import { addActionHandler, getGlobal, setGlobal } from '../../index';

addActionHandler('loadCallLog', async (global): Promise<void> => {
  const entries = await callApi('fetchCallLog');
  if (!entries) return;

  global = getGlobal();
  global = { ...global, callLog: entries };
  setGlobal(global);
});

// The calls list opened; the engine sends the call log again with the calls as seen
addActionHandler('markCallLogSeen', async (): Promise<void> => {
  await callApi('markCallLogSeen');
});

addActionHandler('clearCallLog', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  const result = await callApi('clearCallLog');
  if (!result) return;

  global = getGlobal();
  global = { ...global, callLog: [] };
  setGlobal(global);
  actions.showNotification({ message: { key: 'CallLogCleared' }, tabId });
});
