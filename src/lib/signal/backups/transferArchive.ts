import type { AccountRecord, TransferArchive } from '../store/SignalStore';

import { SIGNAL_CDN_HOSTS, SIGNAL_CHAT_HOST } from '../config';
import { pause } from '../../../util/schedulers';
import { getAccountCredentials } from '../account/linkDevice';
import { sendHttpRequest } from '../net/http';
import { getBasicAuthorization, HttpError } from '../net/rest';

export type TransferArchiveResponse = TransferArchive | { error: 'RELINK_REQUESTED' | 'CONTINUE_WITHOUT_UPLOAD' };

type OnProgress = (receivedLength: number, totalLength: number) => void;

// Signal Desktop `getTransferArchive` in `ts/textsecure/WebAPI.preload.ts`
const WAIT_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_LEEWAY_MS = 15 * 1000;
const RECONNECT_DELAY_MS = 5000;
const MS_PER_SECOND = 1000;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_FOUND = 404;

const textDecoder = new TextDecoder();

/** The primary device uploaded nothing within the wait; waiting again would not change that */
export class TransferArchiveTimeoutError extends Error {
  constructor() {
    super('Timed out waiting for the transfer archive');
  }
}

/**
 * Waits for the primary device to upload the message history archive (`GET /v1/devices/transfer_archive`).
 * Each request waits on the server for up to five minutes and answers 204 when nothing arrived; the wait ends
 * after an hour, as in Signal Desktop `getTransferArchive` (`ts/textsecure/WebAPI.preload.ts`).
 */
export async function waitForTransferArchive(account: AccountRecord, signal?: AbortSignal) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  const authorization = getBasicAuthorization(getAccountCredentials(account));

  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new TransferArchiveTimeoutError();
    const timeoutSeconds = Math.max(1, Math.round(Math.min(remainingMs, MAX_REQUEST_TIMEOUT_MS) / MS_PER_SECOND));

    // A bit of leeway lets the server answer before the request gives up
    const timeout = AbortSignal.timeout(timeoutSeconds * MS_PER_SECOND + REQUEST_LEEWAY_MS);
    let response;
    try {
      response = await sendHttpRequest(SIGNAL_CHAT_HOST, {
        method: 'GET',
        path: `/v1/devices/transfer_archive?timeout=${timeoutSeconds}`,
        headers: { Authorization: authorization },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      // A connection can drop or time out during the long wait; the next request goes on waiting
      if (signal?.aborted) throw err;
      await pause(RECONNECT_DELAY_MS);
      continue;
    }
    if (response.status === HTTP_OK) {
      return JSON.parse(textDecoder.decode(response.body)) as TransferArchiveResponse;
    }
    if (response.status !== HTTP_NO_CONTENT) {
      throw new HttpError(response.status, textDecoder.decode(response.body));
    }
  }
}

/**
 * Downloads the encrypted archive from the CDN (Signal Desktop `getEphemeralBackupStream`); returns
 * `undefined` when the CDN no longer has it
 */
export async function downloadTransferArchive(
  { cdn, key }: TransferArchive, onProgress?: OnProgress, signal?: AbortSignal,
) {
  const host = SIGNAL_CDN_HOSTS[cdn];
  if (!host) throw new Error(`Unknown transfer archive CDN ${cdn}`);

  const response = await sendHttpRequest(host, {
    method: 'GET',
    path: `/attachments/${encodeURIComponent(key)}`,
    signal,
    onReceiveProgress: onProgress,
  });
  if (response.status === HTTP_NOT_FOUND) return undefined;
  if (response.status !== HTTP_OK) throw new HttpError(response.status, '');
  return response.body;
}
