import { bufferToBase64 } from '../../../util/encoding/buffer';
import { encodeUtf8 } from '../crypto';
import { sendHttpRequest } from './http';

export type Credentials = {
  username: string;
  password: string;
};

type JsonRequest = {
  method: string;
  path: string;
  json?: unknown;
  credentials?: Credentials;
};

const HTTP_MULTIPLE_CHOICES = 300;

const textDecoder = new TextDecoder();

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

export function getBasicAuthorization({ username, password }: Credentials) {
  return `Basic ${bufferToBase64(encodeUtf8(`${username}:${password}`))}`;
}

/** Sends a JSON request over HTTP and parses the JSON response; throws `HttpError` on non-2xx statuses */
export async function sendJsonRequest<T>(host: string, {
  method, path, json, credentials,
}: JsonRequest): Promise<T | undefined> {
  const headers: Record<string, string> = {};
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (credentials) headers.Authorization = getBasicAuthorization(credentials);

  const response = await sendHttpRequest(host, {
    method,
    path,
    headers,
    body: json !== undefined ? encodeUtf8(JSON.stringify(json)) : undefined,
  });

  const text = textDecoder.decode(response.body);
  if (response.status >= HTTP_MULTIPLE_CHOICES) {
    throw new HttpError(response.status, text);
  }
  return text ? JSON.parse(text) as T : undefined;
}
