import {
  DEBUG, SKELETON_SNAPSHOT_PATH, SNAPSHOT_CACHE_NAME, WALLPAPER_SNAPSHOT_PATH,
} from '../config';
import { pause } from '../util/schedulers';
import { clearAssetCache, respondWithCache, respondWithCacheNetworkFirst } from './assetCache';
import { handleDownloadMessage, respondForDownload } from './download';
import { respondForProgressive } from './progressive';
import { handleClientMessage as handleNotificationMessage, handleNotificationClick } from './pushNotification';
import { handleClientMessage as handleShareMessage, respondForShare } from './share';

declare const self: ServiceWorkerGlobalScope;

const CACHE_FIRST_ASSET_EXTENSIONS = 'js|css|woff2|svg|png|jpe?g|webp|avif|tgs|bin|json|wasm';
const RE_NETWORK_FIRST_ASSETS = /\.(wasm|html)$/;
const RE_CACHE_FIRST_ASSETS = new RegExp(
  `(?:/assets/[^/]+|/(?:[^/]+\\.)?worker|/index)-[\\w-]{8}`
  + `\\.(${CACHE_FIRST_ASSET_EXTENSIONS})$`,
);
const ACTIVATE_TIMEOUT = 3000;
const SNAPSHOT_PATHS = [WALLPAPER_SNAPSHOT_PATH, SKELETON_SNAPSHOT_PATH];

self.addEventListener('install', (e) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('ServiceWorker installed');
  }

  // Activate worker immediately
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('ServiceWorker activated');
  }

  e.waitUntil(
    Promise.race([
      // An attempt to fix freezing UI on iOS
      pause(ACTIVATE_TIMEOUT),
      Promise.all([
        clearAssetCache(),
        // Become available to all pages
        self.clients.claim(),
      ]),
    ]),
  );
});

self.addEventListener('fetch', (e: FetchEvent) => {
  const { url } = e.request;
  const { scope } = self.registration;
  if (!url.startsWith(scope)) {
    return false;
  }

  const { pathname, protocol } = new URL(url);
  const { pathname: scopePathname } = new URL(scope);

  if (SNAPSHOT_PATHS.some((path) => pathname.endsWith(`/${path}`))) {
    e.respondWith(respondWithSnapshot(e.request));
    return true;
  }

  if (pathname.includes('/progressive/')) {
    e.respondWith(respondForProgressive(e));
    return true;
  }

  if (pathname.includes('/download/')) {
    e.respondWith(respondForDownload(e));
    return true;
  }

  if (pathname.includes('/share/')) {
    e.respondWith(respondForShare(e));
  }

  if (protocol === 'http:' || protocol === 'https:') {
    if ((pathname === scopePathname && e.request.mode === 'navigate') || pathname.match(RE_NETWORK_FIRST_ASSETS)) {
      e.respondWith(respondWithCacheNetworkFirst(e));
      return true;
    }

    if (pathname.match(RE_CACHE_FIRST_ASSETS)) {
      e.respondWith(respondWithCache(e));
      return true;
    }
  }

  return false;
});

// The page saves it, and the empty file from `public` stands in until then
async function respondWithSnapshot(request: Request) {
  const cached = await self.caches.match(request, { cacheName: SNAPSHOT_CACHE_NAME });
  return cached || fetch(request);
}

self.addEventListener('notificationclick', handleNotificationClick);
self.addEventListener('message', (event) => {
  if (event.data?.type === 'claimClient') {
    event.waitUntil(self.clients.claim());
    return;
  }

  handleNotificationMessage(event);
  handleShareMessage(event);
  handleDownloadMessage(event);
});
