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

addActionHandler('clearCallLog', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  const result = await callApi('clearCallLog');
  if (!result) return;

  global = getGlobal();
  global = { ...global, callLog: [] };
  setGlobal(global);
  actions.showNotification({ message: { key: 'CallLogCleared' }, tabId });
});
