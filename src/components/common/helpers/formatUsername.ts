import { USERNAME_LINK_PREFIX } from '../../../config';

export default function formatUsername(username: string, asAbsoluteLink?: boolean) {
  return asAbsoluteLink ? `${USERNAME_LINK_PREFIX}${username}` : `@${username}`;
}
