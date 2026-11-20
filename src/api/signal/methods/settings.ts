import type { ApiConfig } from '../../types';

import { getServerTime } from '../../../util/serverTime';

// The config is local, so it is checked again only once a day
const CONFIG_TTL = 24 * 60 * 60;
// Signal messages can be edited for a day after sending (`EDIT_MAX_AGE_MS` in `MessageProcessor`)
const EDIT_TIME_LIMIT = 24 * 60 * 60;
// Signal Desktop `global.groupsv2.groupSizeHardLimit`, ourselves included
const MAX_GROUP_SIZE = 1001;
// Signal Desktop `MAX_PLAINTEXT_BODY_ATTACHMENT_BYTE_LENGTH` in `ts/util/longAttachment.std.ts`
const MAX_MESSAGE_LENGTH = 64 * 1024;

/**
 * Signal limits in the shape of Telegram's config. Forwarded messages are sent one by one, so they are not
 * split into batches, and there are no server-side top peer ratings.
 */
export function fetchConfig() {
  return Promise.resolve<ApiConfig>({
    expiresAt: getServerTime() + CONFIG_TTL,
    maxGroupSize: MAX_GROUP_SIZE,
    maxMessageLength: MAX_MESSAGE_LENGTH,
    editTimeLimit: EDIT_TIME_LIMIT,
    maxForwardedCount: 0,
    ratingEDecay: 0,
  });
}
