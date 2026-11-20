import type { RegularLangKey } from '../types/language';

import { SIGNAL_CHAT_HOST } from '../lib/signal/config';

type SignalProxyUrlResult = { url: string; errorKey?: undefined } | { url?: undefined; errorKey: RegularLangKey };

// Unencrypted WebSocket stays on this device
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const SIGNAL_PORT = '443';
const CHECK_TIMEOUT_MS = 10000;

/** Normalizes a proxy server URL: `wss://`, or `ws://` for this device, without credentials */
export function parseSignalProxyUrl(value: string): SignalProxyUrlResult {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { errorKey: 'SignalProxyErrorInvalid' };
  }

  const isLocal = LOCAL_HOSTNAMES.has(url.hostname);
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && isLocal)) {
    return { errorKey: 'SignalProxyErrorProtocol' };
  }
  if (url.username || url.password) return { errorKey: 'SignalProxyErrorCredentials' };
  // WebSocket URLs cannot have a fragment
  if (url.hash) return { errorKey: 'SignalProxyErrorInvalid' };

  return { url: url.href };
}

/**
 * Resolves whether the tunnel accepts a WebSocket to Signal's chat host. The tunnel then waits for a TLS
 * handshake, so success means the tunnel is reachable, not that it reaches Signal.
 */
export async function checkSignalProxyUrl(proxyUrl: string) {
  const url = new URL(proxyUrl);
  url.searchParams.set('host', SIGNAL_CHAT_HOST);
  url.searchParams.set('port', SIGNAL_PORT);

  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => finish(false), CHECK_TIMEOUT_MS);

    function finish(isReachable: boolean) {
      clearTimeout(timeout);
      socket.close();
      resolve(isReachable);
    }

    socket.onopen = () => finish(true);
    // `onerror` is followed by `onclose`
    socket.onclose = () => finish(false);
  });
}
