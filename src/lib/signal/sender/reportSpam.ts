import type ChatConnection from '../chat/ChatConnection';

import { bufferToBase64 } from '../../../util/encoding/buffer';

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
// Signal Desktop `getMessageServerGuidsForSpam` in `ts/sql/Server.node.ts`: the server takes at most three
export const MAX_SPAM_REPORT_MESSAGES = 3;

/**
 * Reports messages of a sender as spam with the reporting token of its latest envelope
 * (`POST /v1/messages/report/{aci}/{serverGuid}`, Signal Android `MessageApi.reportSpam`)
 */
export async function reportSpam(
  connection: ChatConnection, senderAci: string, serverGuids: string[], token?: Uint8Array,
) {
  for (const serverGuid of serverGuids) {
    const { status } = await connection.sendJsonRequest('POST', `/v1/messages/report/${senderAci}/${serverGuid}`, {
      token: token?.length ? bufferToBase64(token) : undefined,
    });
    if (status !== HTTP_OK && status !== HTTP_NO_CONTENT) {
      throw new Error(`Spam report failed with HTTP ${status}`);
    }
  }
}
