import { Api as GramJs } from '../../../lib/gramjs';

import type { ApiInlineButtonAction } from '../../types';

import { serializeBytes } from '../helpers/misc';

export function buildApiInlineButtonAction(type: GramJs.TypeInlineButtonType): ApiInlineButtonAction {
  if (type instanceof GramJs.InlineButtonTypeUrl) return { type: 'url', url: type.url };
  if (type instanceof GramJs.InlineButtonTypeBuy) return { type: 'buy' };
  if (type instanceof GramJs.InlineButtonTypeGame) return { type: 'game' };
  if (type instanceof GramJs.InlineButtonTypeDisabled) return { type: 'disabled' };
  if (type instanceof GramJs.InlineButtonTypeCallback) {
    return { type: 'callback', data: serializeBytes(type.data), requiresPassword: type.requiresPassword };
  }
  if (type instanceof GramJs.InlineButtonTypeSwitchInline) {
    return {
      type: 'switchBotInline',
      query: type.query,
      isSamePeer: type.samePeer,
    };
  }
  if (type instanceof GramJs.InlineButtonTypeUserProfile) {
    return { type: 'userProfile', userId: String(type.userId) };
  }
  if (type instanceof GramJs.InlineButtonTypeWebView) return { type: 'webView', url: type.url };
  if (type instanceof GramJs.InlineButtonTypeUrlAuth) {
    return { type: 'urlAuth', url: type.url, buttonId: type.buttonId, forwardText: type.fwdText };
  }
  if (type instanceof GramJs.InlineButtonTypeCopy) return { type: 'copy', copyText: type.copyText };
  return { type: 'unsupported' };
}
