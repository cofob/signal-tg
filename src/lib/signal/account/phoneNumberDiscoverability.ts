import type ChatConnection from '../chat/ChatConnection';

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;

/**
 * Sets whether people can find us by phone number (`PUT /v2/accounts/phone_number_discoverability`); Signal Desktop
 * changes it from a linked device through `setDiscoverableByPhoneNumber`
 */
export async function setPhoneNumberDiscoverability(connection: ChatConnection, isDiscoverable: boolean) {
  const { status } = await connection.sendJsonRequest('PUT', '/v2/accounts/phone_number_discoverability', {
    discoverableByPhoneNumber: isDiscoverable,
  });
  if (status !== HTTP_OK && status !== HTTP_NO_CONTENT) {
    throw new Error(`Phone number discoverability update failed with HTTP ${status}`);
  }
}
