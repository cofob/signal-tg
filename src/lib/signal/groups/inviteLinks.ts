import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import { base64UrlToBuffer, bufferToBase64Url } from '../../../util/encoding/base64';

import { GroupInviteLinkSchema } from '../proto/generated/Groups_pb';

const INVITE_LINK_PREFIX = 'https://signal.group/#';
// `https://signal.group/#<code>` and `sgnl://signal.group/#<code>`; the code is base64url, with or without padding
const INVITE_LINK_PATTERN = /^(?:https|sgnl):\/\/signal\.group\/?#([A-Za-z0-9_-]+)=*$/;
const MASTER_KEY_LENGTH = 32;

/** The group link of a group with a link password (Signal Desktop `ts/groups.preload.ts`, `buildGroupLink`) */
export function buildGroupInviteLink(masterKey: Uint8Array, inviteLinkPassword: Uint8Array) {
  const bytes = toBinary(GroupInviteLinkSchema, create(GroupInviteLinkSchema, {
    contents: { case: 'contentsV1', value: { groupMasterKey: masterKey, inviteLinkPassword } },
  }));
  return `${INVITE_LINK_PREFIX}${bufferToBase64Url(bytes)}`;
}

/** The master key and link password of a group link, or `undefined` for other text (Signal Desktop `parseGroupLink`) */
export function parseGroupInviteLink(link: string) {
  const code = link.trim().match(INVITE_LINK_PATTERN)?.[1];
  if (!code) return undefined;

  try {
    const { contents } = fromBinary(GroupInviteLinkSchema, base64UrlToBuffer(code));
    if (contents.case !== 'contentsV1') return undefined;
    const { groupMasterKey, inviteLinkPassword } = contents.value;
    if (groupMasterKey.length !== MASTER_KEY_LENGTH || !inviteLinkPassword.length) return undefined;
    return { masterKey: groupMasterKey, inviteLinkPassword };
  } catch {
    return undefined;
  }
}
