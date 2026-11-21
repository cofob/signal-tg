import type ChatConnection from '../chat/ChatConnection';

const HTTP_NO_CONTENT = 204;
const HTTP_OK = 200;

/**
 * Capabilities of this device (Signal Desktop `ts/util/getCapabilities.std.ts`); `storage` tells that a primary
 * device stored its master key in SVR2
 */
export function getDeviceCapabilities(hasPhoneNumber: boolean, hasSvrPin?: boolean) {
  return {
    // The server only uses the primary device's value
    attachmentBackfill: false,
    spqr: true,
    usernameChangeSyncMessage: true,
    optionalPhoneNumber: !hasPhoneNumber,
    storage: Boolean(hasSvrPin),
  };
}

/** Sends the capabilities on startup, so they follow app updates (`PUT /v1/devices/capabilities`) */
export async function updateDeviceCapabilities(
  connection: ChatConnection, hasPhoneNumber: boolean, hasSvrPin?: boolean,
) {
  const { status } = await connection.sendJsonRequest(
    'PUT', '/v1/devices/capabilities', getDeviceCapabilities(hasPhoneNumber, hasSvrPin),
  );
  if (status !== HTTP_OK && status !== HTTP_NO_CONTENT) {
    throw new Error(`Capabilities update failed with HTTP ${status}`);
  }
}
