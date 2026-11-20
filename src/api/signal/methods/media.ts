import type { ApiOnProgress } from '../../types';
import { ApiMediaFormat } from '../../types';

import { MEDIA_CACHE_DISABLED, MEDIA_CACHE_NAME, MEDIA_CACHE_NAME_AVATARS } from '../../../config';
import { downloadGroupAvatar } from '../../../lib/signal/groups/fetchGroup';
import { downloadProfileAvatar } from '../../../lib/signal/profiles/fetchProfile';
import * as cacheApi from '../../../util/cacheApi';
import { getCurrentAccount } from '../client';
import { store } from '../engine';
import { fetchAttachmentBlob, getAttachmentPointer } from '../media/attachments';
import { renderBlurHash } from '../media/blurHash';
import { getConversationByPeerId } from '../peers';

// Hashes from `src/global/helpers/messageMedia.ts` and `getChatAvatarHash`: `photo<mediaId>?size=x`,
// `document<mediaId>?download`, `avatar<peerId>?<avatarPhotoId>`. Streamed parts arrive as full
// `./progressive/<hash>` and `./download/<hash>` URLs.
const MEDIA_HASH_REGEX = /^(photo|document|avatar|profile)(-?\d+(?:_\w+)?)(?:\?(.*))?$/;
const STREAM_URL_PREFIX_REGEX = /^.*\/(?:progressive|download)\//;
// Signal clients encode avatars as JPEG; image decoders also sniff the actual format
const AVATAR_MIME_TYPE = 'image/jpeg';
const BLURHASH_MIME_TYPE = 'image/bmp';
// Previews from a BlurHash are not stored in app state, so they can be larger than thumbnails
const BLURHASH_PREVIEW_PIXEL_COUNT = 64 * 64;

/** Downloads message attachments and avatars, decrypted, in the format the media loader asks for */
export async function downloadMedia(
  {
    url, mediaFormat, start, end,
  }: {
    url: string; mediaFormat: ApiMediaFormat; start?: number; end?: number;
  },
  onProgress?: ApiOnProgress,
) {
  const [, type, id, query] = url.replace(STREAM_URL_PREFIX_REGEX, '').match(MEDIA_HASH_REGEX) ?? [];
  if (!type) throw new Error(`Unsupported media ${url}`);

  const blob = type === 'avatar' || type === 'profile'
    ? await fetchAvatar(url, id)
    : await fetchMessageMedia(id, new URLSearchParams(query).has('size'), onProgress);

  const { type: mimeType, size: fullSize } = blob;
  // Streamed parts take bytes `start` to `end`, inclusive
  if (mediaFormat === ApiMediaFormat.Progressive || mediaFormat === ApiMediaFormat.DownloadUrl) {
    const arrayBuffer = await blob.slice(start, end !== undefined ? end + 1 : undefined).arrayBuffer();
    return {
      dataBlob: '', arrayBuffer, mimeType, fullSize,
    };
  }

  const dataBlob = mediaFormat === ApiMediaFormat.Text ? await blob.text() : blob;
  return {
    dataBlob, arrayBuffer: undefined, mimeType, fullSize,
  };
}

async function fetchMessageMedia(mediaId: string, isThumbnail: boolean, onProgress?: ApiOnProgress) {
  const pointer = await getAttachmentPointer(mediaId);
  if (!pointer) throw new Error(`Attachment ${mediaId} is not found`);
  if (!isThumbnail || pointer.contentType.startsWith('image/')) return fetchAttachmentBlob(pointer, onProgress);

  // Signal attachments have no thumbnails: images serve their own sizes, other media their BlurHash
  const { blurHash, width, height } = pointer;
  const bitmap = blurHash
    ? renderBlurHash(blurHash, width || undefined, height || undefined, BLURHASH_PREVIEW_PIXEL_COUNT)
    : undefined;
  if (!bitmap) throw new Error(`Attachment ${mediaId} has no thumbnail`);
  return new Blob([bitmap], { type: BLURHASH_MIME_TYPE });
}

/** Avatars of users are encrypted with their profile key, those of groups with the group's secret params */
async function fetchAvatar(url: string, peerId: string) {
  const conversation = await getConversationByPeerId(peerId);
  if (!conversation?.avatarPath) throw new Error(`Peer ${peerId} has no avatar`);

  const data = conversation.type === 'group'
    ? await downloadGroupAvatar(conversation.avatarPath, conversation.masterKey!)
    : await downloadProfileAvatar(conversation.avatarPath, await getProfileKey(conversation.id));
  // Protobuf bytes are typed as views of any buffer, which `Blob` does not take
  const blob = new Blob([data.slice()], { type: AVATAR_MIME_TYPE });

  // The media loader reads avatars from these caches before asking for them
  if (!MEDIA_CACHE_DISABLED) {
    void cacheApi.save(url.startsWith('avatar') ? MEDIA_CACHE_NAME_AVATARS : MEDIA_CACHE_NAME, url, blob);
  }
  return blob;
}

async function getProfileKey(aci: string) {
  const account = getCurrentAccount();
  const profileKey = aci === account?.aci ? account.profileKey : (await store.getRecipient(aci))?.profileKey;
  if (!profileKey) throw new Error(`No profile key for ${aci}`);
  return profileKey;
}
