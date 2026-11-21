import { callApi } from '../../../api';
import { addActionHandler, getGlobal, setGlobal } from '../../index';

addActionHandler('loadNotificationProfiles', async (global): Promise<void> => {
  const state = await callApi('fetchNotificationProfiles');
  if (!state) return;

  global = getGlobal();
  global = { ...global, notificationProfiles: state };
  setGlobal(global);
});

addActionHandler('saveNotificationProfile', async (global, actions, payload): Promise<void> => {
  const state = await callApi('saveNotificationProfile', { profile: payload.profile });
  if (!state) return;

  global = getGlobal();
  global = { ...global, notificationProfiles: state };
  setGlobal(global);
});

addActionHandler('deleteNotificationProfile', async (global, actions, payload): Promise<void> => {
  const state = await callApi('deleteNotificationProfile', { id: payload.id });
  if (!state) return;

  global = getGlobal();
  global = { ...global, notificationProfiles: state };
  setGlobal(global);
});

addActionHandler('setNotificationProfileActive', async (global, actions, payload): Promise<void> => {
  const state = await callApi('setNotificationProfileActive', payload);
  if (!state) return;

  global = getGlobal();
  global = { ...global, notificationProfiles: state };
  setGlobal(global);
});
