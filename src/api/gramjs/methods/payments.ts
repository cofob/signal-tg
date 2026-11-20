import { Api as GramJs } from '../../../lib/gramjs';
import { RPCError } from '../../../lib/gramjs/errors';

import type {
  ApiChat,
  ApiInputStorePaymentPurpose,
  ApiPeer,
  ApiRequestInputInvoice,
  ApiThemeParameters,
} from '../../types';

import { DEBUG } from '../../../config';
import {
  buildApiBoostsStatus,
  buildApiCheckedGiftCode,
  buildApiGiveawayInfo,
  buildApiMyBoost,
  buildApiPaymentForm,
  buildApiPremiumGiftCodeOption,
  buildApiPremiumPromo,
} from '../apiBuilders/payments';
import {
  buildInputInvoice,
  buildInputPeer,
  buildInputStorePaymentPurpose,
  buildInputThemeParams,
} from '../gramjsBuilders';
import localDb from '../localDb';
import { handleGramJsUpdate, invokeRequest } from './client';

export async function sendStarPaymentForm({
  formId,
  inputInvoice,
}: {
  formId: string;
  inputInvoice: ApiRequestInputInvoice;
}) {
  const result = await invokeRequest(new GramJs.payments.SendStarsForm({
    formId: BigInt(formId),
    invoice: buildInputInvoice(inputInvoice),
  }));

  if (!result) return undefined;

  if (result instanceof GramJs.payments.PaymentVerificationNeeded) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn('Unexpected PaymentVerificationNeeded in sendStarsForm');
    }

    return undefined;
  }

  handleGramJsUpdate(result.updates);

  return {
    completed: true,
  };
}

export async function getPaymentForm(inputInvoice: ApiRequestInputInvoice, theme?: ApiThemeParameters) {
  try {
    const result = await invokeRequest(new GramJs.payments.GetPaymentForm({
      invoice: buildInputInvoice(inputInvoice),
      themeParams: theme ? buildInputThemeParams(theme) : undefined,
    }), {
      shouldThrow: true,
    });

    if (!result) {
      return undefined;
    }

    return buildApiPaymentForm(result);
  } catch (err: any) {
    if (err instanceof RPCError) {
      return {
        error: err.errorMessage,
      };
    } else {
      throw err;
    }
  }
}

export async function fetchPremiumPromo() {
  const result = await invokeRequest(new GramJs.help.GetPremiumPromo());
  if (!result) return undefined;

  result.videos.forEach((video) => {
    if (video instanceof GramJs.Document) {
      localDb.documents[video.id.toString()] = video;
    }
  });

  return {
    promo: buildApiPremiumPromo(result),
  };
}

export async function fetchMyBoosts() {
  const result = await invokeRequest(new GramJs.premium.GetMyBoosts());

  if (!result) return undefined;

  const boosts = result.myBoosts.map(buildApiMyBoost);

  return {
    boosts,
  };
}

export async function applyBoost({
  chat,
  slots,
}: {
  chat: ApiChat;
  slots: number[];
}) {
  const result = await invokeRequest(new GramJs.premium.ApplyBoost({
    peer: buildInputPeer(chat.id, chat.accessHash),
    slots,
  }));

  if (!result) return undefined;

  const boosts = result.myBoosts.map(buildApiMyBoost);

  return {
    boosts,
  };
}

export async function fetchBoostStatus({
  chat,
}: {
  chat: ApiChat;
}) {
  const result = await invokeRequest(new GramJs.premium.GetBoostsStatus({
    peer: buildInputPeer(chat.id, chat.accessHash),
  }));

  if (!result) {
    return undefined;
  }

  return buildApiBoostsStatus(result);
}

export async function fetchGiveawayInfo({
  peer,
  messageId,
}: {
  peer: ApiPeer;
  messageId: number;
}) {
  const result = await invokeRequest(new GramJs.payments.GetGiveawayInfo({
    peer: buildInputPeer(peer.id, peer.accessHash),
    msgId: messageId,
  }));

  if (!result) {
    return undefined;
  }

  return buildApiGiveawayInfo(result);
}

export async function checkGiftCode({
  slug,
}: {
  slug: string;
}) {
  const result = await invokeRequest(new GramJs.payments.CheckGiftCode({
    slug,
  }));

  if (!result) {
    return undefined;
  }

  return {
    code: buildApiCheckedGiftCode(result),
  };
}

export function applyGiftCode({
  slug,
}: {
  slug: string;
}) {
  return invokeRequest(new GramJs.payments.ApplyGiftCode({
    slug,
  }), {
    shouldReturnTrue: true,
  });
}

export async function getPremiumGiftCodeOptions({
  chat,
}: {
  chat?: ApiChat;
}) {
  const result = await invokeRequest(new GramJs.payments.GetPremiumGiftCodeOptions({
    boostPeer: chat && buildInputPeer(chat.id, chat.accessHash),
  }));

  if (!result) {
    return undefined;
  }

  return result.map(buildApiPremiumGiftCodeOption);
}

export function launchPrepaidGiveaway({
  chat,
  giveawayId,
  paymentPurpose,
}: {
  chat: ApiChat;
  giveawayId: string;
  paymentPurpose: ApiInputStorePaymentPurpose;
}) {
  return invokeRequest(new GramJs.payments.LaunchPrepaidGiveaway({
    peer: buildInputPeer(chat.id, chat.accessHash),
    giveawayId: BigInt(giveawayId),
    purpose: buildInputStorePaymentPurpose(paymentPurpose),
  }), {
    shouldReturnTrue: true,
  });
}
