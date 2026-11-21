import type UnauthenticatedChat from '../chat/UnauthenticatedChat';

const SEARCH_PATH = '/v1/key-transparency/search';
const DISTINGUISHED_PATH = '/v1/key-transparency/distinguished';
const MONITOR_PATH = '/v1/key-transparency/monitor';
const HTTP_SUCCESS_MAX = 299;
const HTTP_RATE_LIMITED = 429;
const HTTP_SERVER_ERROR_MIN = 500;
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

/** A key transparency request that the server answered with an error status */
export class KeyTransparencyRequestError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds?: number) {
    super(`Key transparency request failed with HTTP ${status}`);
  }

  get isRateLimited() {
    return this.status === HTTP_RATE_LIMITED;
  }

  get isServerError() {
    return this.status >= HTTP_SERVER_ERROR_MIN;
  }
}

/** The three requests of `KeyTransparency_Check`, sent on the socket without account credentials */
export type KeyTransparencyTransport = {
  search(body: Uint8Array): Promise<Uint8Array>;
  distinguished(lastTreeHeadSize: number | undefined): Promise<Uint8Array>;
  monitor(body: Uint8Array): Promise<Uint8Array>;
};

/**
 * The callbacks that `rust/signal-wasm/src/keytrans/transport.rs` describes. Each resolves to the body of a
 * successful response; an aborted `signal` stops the check at its next request.
 */
export function createTransport(chat: UnauthenticatedChat, signal?: AbortSignal): KeyTransparencyTransport {
  async function send(verb: string, path: string, body?: Uint8Array) {
    signal?.throwIfAborted();
    const response = await chat.sendRequest({ verb, path, headers: JSON_HEADERS, body });
    signal?.throwIfAborted();

    if (response.status > HTTP_SUCCESS_MAX) {
      const retryAfter = response.headers.get('retry-after');
      throw new KeyTransparencyRequestError(response.status, retryAfter ? Number(retryAfter) : undefined);
    }
    return response.body ?? new Uint8Array();
  }

  return {
    search: (body) => send('POST', SEARCH_PATH, body),
    distinguished: (lastTreeHeadSize) => send(
      'GET', `${DISTINGUISHED_PATH}?${lastTreeHeadSize === undefined ? '' : `lastTreeHeadSize=${lastTreeHeadSize}`}`,
    ),
    monitor: (body) => send('POST', MONITOR_PATH, body),
  };
}
