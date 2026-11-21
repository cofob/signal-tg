import { getActions } from '../global';

import { DEBUG, IS_TEST } from '../config';
// eslint-disable-next-line import-x/default
import serviceWorkerUrl from '../serviceWorker/service.worker.ts?worker&url';
import { IS_ANDROID, IS_IOS, IS_SERVICE_WORKER_SUPPORTED } from './browser/windowEnvironment';
import { formatShareText } from './deeplink';
import { validateFiles } from './files';
import { notifyClientReady, playNotifySoundDebounced } from './notifications';
import { handlePushWorkerMessage, initPushNotifications, notifyPushClientReady } from './pushNotifications';

type WorkerAction = {
  type: string;
  payload: Record<string, any>;
};

const CONTROLLER_TIMEOUT_MS = 3000;
// The worker of Web A's directory (`/a/`); Web K at `/k/` has its own
const SERVICE_WORKER_OPTIONS: RegistrationOptions = { scope: './', type: 'module' };

function handleWorkerMessage(e: MessageEvent) {
  const action: WorkerAction = e.data;
  void handlePushWorkerMessage(e).catch(() => undefined);
  if (!action.type) return;
  const dispatch = getActions();
  const payload = action.payload;
  switch (action.type) {
    case 'playNotificationSound':
      playNotifySoundDebounced(action.payload.id);
      break;
    case 'share':
      dispatch.openChatWithDraft({
        text: formatShareText(payload.url, payload.text, payload.title),
        files: validateFiles(payload.files),
      });
      break;
  }
}

let subscribedController: ServiceWorker | undefined;

function subscribeToWorker() {
  // Both `controllerchange` and the load handler can report the same controller
  if (subscribedController === navigator.serviceWorker.controller) return;
  subscribedController = navigator.serviceWorker.controller || undefined;

  navigator.serviceWorker.removeEventListener('message', handleWorkerMessage);
  navigator.serviceWorker.addEventListener('message', handleWorkerMessage);
  // Notify web worker that client is ready to receive messages
  notifyClientReady();
  initPushNotifications();
  notifyPushClientReady();
}

if (IS_SERVICE_WORKER_SUPPORTED) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (navigator.serviceWorker.controller) subscribeToWorker();
  });

  window.addEventListener('load', async () => {
    try {
      // Versions served from the root of the origin registered their worker there, where it would control Web K's
      // pages at `/k/` too; each frontend now has a worker of its own directory
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter(({ scope }) => scope === `${window.location.origin}/`)
        .map((registration) => registration.unregister()));

      await navigator.serviceWorker.register(serviceWorkerUrl, SERVICE_WORKER_OPTIONS);

      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log('[SW] ServiceWorker registered');
      }

      const registration = await navigator.serviceWorker.ready;

      if (!navigator.serviceWorker.controller && registration.active) {
        const worker = registration.active;
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(finish, CONTROLLER_TIMEOUT_MS);

          function finish() {
            clearTimeout(timeout);
            navigator.serviceWorker.removeEventListener('controllerchange', finish);
            resolve();
          }

          navigator.serviceWorker.addEventListener('controllerchange', finish);
          worker.postMessage({ type: 'claimClient' });
        });
      }

      if (navigator.serviceWorker.controller) {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.log('[SW] ServiceWorker ready');
        }
        subscribeToWorker();
      } else {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.error('[SW] ServiceWorker not available');
        }

        if (!IS_IOS && !IS_ANDROID && !IS_TEST) {
          getActions().showDialog?.({ data: { type: 'error', message: 'SERVICE_WORKER_DISABLED', hasErrorKey: true } });
        }
      }
    } catch (err) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.error('[SW] ServiceWorker registration failed: ', err);
      }
    }
  });
  window.addEventListener('focus', async () => {
    await navigator.serviceWorker.ready;
    subscribeToWorker();
  });
}
