export type SignalMeLink = { type: 'usernameLink'; url: string } | { type: 'phoneNumber'; phoneNumber: string };

// `https://signal.me/#eu/<link>` (username links and their QR codes) and `https://signal.me/#p/+<number>`;
// the desktop app receives them as `sgnl://signal.me/...`
const RE_SIGNAL_ME_LINK = /^(?:https|sgnl):\/\/signal\.me\/?#(eu|p)\/([^/?#]+)$/i;

export function parseSignalMeLink(url: string): SignalMeLink | undefined {
  const match = url.match(RE_SIGNAL_ME_LINK);
  if (!match) return undefined;
  return match[1].toLowerCase() === 'eu'
    ? { type: 'usernameLink', url }
    : { type: 'phoneNumber', phoneNumber: match[2].replace(/\D/g, '') };
}
