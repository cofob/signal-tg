import { Api as GramJs } from '../../../lib/gramjs';

import type {
  ApiChat,
  ApiInputStorePaymentPurpose,
  ApiPeer,
} from '../../types';

import {
  buildApiBoostsStatus,
  buildApiGiveawayInfo,
  buildApiMyBoost,
  buildApiPremiumGiftCodeOption,
  buildApiPremiumPromo,
} from '../apiBuilders/payments';
import {
  buildInputPeer,
  buildInputStorePaymentPurpose,
} from '../gramjsBuilders';
import localDb from '../localDb';
import { invokeRequest } from './client';

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
