import { Api as GramJs } from '../../../lib/gramjs';
import { RPCError } from '../../../lib/gramjs/errors';

import type { GiftProfileFilterOptions, ResaleGiftsFilterOptions } from '../../../types';
import type {
  ApiPeer,
  ApiRequestInputSavedStarGift,
  ApiStarGiftAttributeId,
  ApiStarGiftRegular,
  ApiTypeCurrencyAmount,
} from '../../types';

import { buildApiChatFromPreview } from '../apiBuilders/chats';
import {
  buildApiFormattedText,
} from '../apiBuilders/common';
import {
  buildApiResaleGifts,
  buildApiSavedStarGift,
  buildApiStarGift,
  buildApiStarGiftAttribute,
  buildApiStarGiftAuctionAcquiredGift,
  buildApiStarGiftAuctionState,
  buildApiStarGiftCollection,
  buildApiStarGiftUpgradePreview,
  buildInputResaleGiftsAttributes,
} from '../apiBuilders/gifts';
import {
  buildApiCurrencyAmount,
  buildApiStarsGiveawayOptions,
  buildApiUniqueStarGiftValueInfo,
} from '../apiBuilders/payments';
import { buildApiUser } from '../apiBuilders/users';
import {
  buildInputPeer,
  buildInputSavedStarGift,
  buildInputStarsAmount,
  DEFAULT_PRIMITIVES } from '../gramjsBuilders';
import { checkErrorType, wrapError } from '../helpers/misc';
import { invokeRequest } from './client';
import { getTemporaryPaymentPassword } from './twoFaSettings';

export async function fetchCheckCanSendGift({ giftId }: { giftId: string }) {
  const result = await invokeRequest(new GramJs.payments.CheckCanSendGift({
    giftId: BigInt(giftId),
  }));

  if (!result) {
    return undefined;
  }

  if (result instanceof GramJs.payments.CheckCanSendGiftResultOk) {
    return { canSend: true };
  }

  if (result instanceof GramJs.payments.CheckCanSendGiftResultFail) {
    return { canSend: false, reason: buildApiFormattedText(result.reason) };
  }

  return undefined;
}

export async function fetchStarsGiveawayOptions() {
  const result = await invokeRequest(new GramJs.payments.GetStarsGiveawayOptions());

  if (!result) {
    return undefined;
  }

  return result.map(buildApiStarsGiveawayOptions);
}

export async function fetchStarGifts() {
  const result = await invokeRequest(new GramJs.payments.GetStarGifts({
    hash: DEFAULT_PRIMITIVES.INT,
  }));

  if (!result || result instanceof GramJs.payments.StarGiftsNotModified) {
    return undefined;
  }

  const chats = result.chats?.map((chat) => buildApiChatFromPreview(chat)).filter(Boolean);
  const users = result.users?.map(buildApiUser).filter(Boolean);

  // Right now, only regular star gifts can be bought, but API are not specific
  const gifts
    = result.gifts.map(buildApiStarGift).filter((gift): gift is ApiStarGiftRegular => gift.type === 'starGift');

  return {
    gifts,
    chats,
    users,
  };
}

export async function fetchResaleGifts({
  giftId,
  offset = DEFAULT_PRIMITIVES.STRING,
  limit = DEFAULT_PRIMITIVES.INT,
  attributesHash,
  filter,
  forCraft,
}: {
  giftId: string;
  offset?: string;
  limit?: number;
  attributesHash?: string;
  filter?: ResaleGiftsFilterOptions;
  forCraft?: boolean;
}) {
  type GetResaleStarGifts = ConstructorParameters<typeof GramJs.payments.GetResaleStarGifts>[0];

  const attributes: ApiStarGiftAttributeId[] = [
    ...(filter?.backdropAttributes ?? []),
    ...(filter?.modelAttributes ?? []),
    ...(filter?.patternAttributes ?? []),
  ];

  const params: GetResaleStarGifts = {
    giftId: BigInt(giftId),
    offset,
    limit,
    attributesHash: attributesHash ? BigInt(attributesHash) : DEFAULT_PRIMITIVES.BIGINT,
    attributes: buildInputResaleGiftsAttributes(attributes),
    forCraft: forCraft || undefined,
    sortByPrice: filter?.sortType === 'byPrice' || undefined,
    sortByNum: filter?.sortType === 'byNumber' || undefined,
    starsOnly: filter?.starsOnly || undefined,
  };

  const result = await invokeRequest(new GramJs.payments.GetResaleStarGifts(params));

  if (!result) {
    return undefined;
  }

  return buildApiResaleGifts(result);
}

export async function fetchSavedStarGifts({
  peer,
  offset = DEFAULT_PRIMITIVES.STRING,
  limit = DEFAULT_PRIMITIVES.INT,
  filter,
  collectionId,
}: {
  peer: ApiPeer;
  offset?: string;
  limit?: number;
  filter?: GiftProfileFilterOptions;
  collectionId?: number;
}) {
  type GetSavedStarGiftsParams = ConstructorParameters<typeof GramJs.payments.GetSavedStarGifts>[0];

  const params: GetSavedStarGiftsParams = {
    peer: buildInputPeer(peer.id, peer.accessHash),
    offset,
    limit,
    collectionId,
    ...(filter && {
      sortByValue: filter.sortType === 'byValue' || undefined,
      excludeUnlimited: !filter.shouldIncludeUnlimited || undefined,
      excludeUpgradable: !filter.shouldIncludeUpgradable || undefined,
      excludeUnupgradable: !filter.shouldIncludeLimited || undefined,
      excludeUnique: !filter.shouldIncludeUnique || undefined,
      excludeSaved: !filter.shouldIncludeDisplayed || undefined,
      excludeUnsaved: !filter.shouldIncludeHidden || undefined,
    } satisfies Partial<GetSavedStarGiftsParams>),
  };

  const result = await invokeRequest(new GramJs.payments.GetSavedStarGifts(params));

  if (!result) {
    return undefined;
  }

  const gifts = result.gifts.map((g) => buildApiSavedStarGift(g, peer.id));

  return {
    gifts,
    nextOffset: result.nextOffset,
  };
}

export function saveStarGift({
  inputGift,
  shouldUnsave,
}: {
  inputGift: ApiRequestInputSavedStarGift;
  shouldUnsave?: boolean;
}) {
  return invokeRequest(new GramJs.payments.SaveStarGift({
    stargift: buildInputSavedStarGift(inputGift),
    unsave: shouldUnsave || undefined,
  }));
}

export function convertStarGift({
  inputSavedGift,
}: {
  inputSavedGift: ApiRequestInputSavedStarGift;
}) {
  return invokeRequest(new GramJs.payments.ConvertStarGift({
    stargift: buildInputSavedStarGift(inputSavedGift),
  }));
}

export function deleteStarGift({
  inputSavedGift,
}: {
  inputSavedGift: ApiRequestInputSavedStarGift;
}) {
  return invokeRequest(new GramJs.payments.DeleteStarGift({
    stargift: buildInputSavedStarGift(inputSavedGift),
  }));
}

export async function fetchStarsStatus({
  isTon,
}: {
  isTon?: boolean;
} = {}) {
  const result = await invokeRequest(new GramJs.payments.GetStarsStatus({
    peer: new GramJs.InputPeerSelf(),
    ton: isTon || undefined,
  }));

  if (!result) {
    return undefined;
  }

  const balance = buildApiCurrencyAmount(result.balance);
  if (!balance) {
    return undefined;
  }

  return balance;
}

export async function fetchUniqueStarGift({ slug }: {
  slug: string;
}) {
  try {
    const result = await invokeRequest(new GramJs.payments.GetUniqueStarGift({ slug }), {
      shouldThrow: true,
    });

    if (!result) return undefined;

    const gift = buildApiStarGift(result.gift);
    if (gift.type !== 'starGiftUnique') return undefined;
    return gift;
  } catch (err) {
    if (err instanceof RPCError) {
      return wrapError(err);
    }
    return undefined;
  }
}

export async function fetchStarGiftUpgradePreview({
  giftId,
}: {
  giftId: string;
}) {
  const result = await invokeRequest(new GramJs.payments.GetStarGiftUpgradePreview({
    giftId: BigInt(giftId),
  }));

  if (!result) {
    return undefined;
  }

  return buildApiStarGiftUpgradePreview(result);
}

export async function fetchStarGiftAuctionState({
  giftId,
  slug,
  version = 0,
}: {
  giftId?: string;
  slug?: string;
  version?: number;
}) {
  if (!giftId && !slug) return undefined;

  const auction = slug
    ? new GramJs.InputStarGiftAuctionSlug({ slug })
    : new GramJs.InputStarGiftAuction({ giftId: BigInt(giftId!) });

  const result = await invokeRequest(new GramJs.payments.GetStarGiftAuctionState({
    auction,
    version,
  }));

  if (!result) {
    return undefined;
  }

  return buildApiStarGiftAuctionState(result);
}

export async function fetchStarGiftAuctionAcquiredGifts({
  giftId,
}: {
  giftId: string;
}) {
  const result = await invokeRequest(new GramJs.payments.GetStarGiftAuctionAcquiredGifts({
    giftId: BigInt(giftId),
  }));

  if (!result) {
    return undefined;
  }

  return {
    gifts: result.gifts.map(buildApiStarGiftAuctionAcquiredGift),
  };
}

export async function fetchStarGiftActiveAuctions() {
  const result = await invokeRequest(new GramJs.payments.GetStarGiftActiveAuctions({
    hash: DEFAULT_PRIMITIVES.BIGINT,
  }));

  if (!result || result instanceof GramJs.payments.StarGiftActiveAuctionsNotModified) {
    return undefined;
  }

  return {
    auctions: result.auctions.map(buildApiStarGiftAuctionState).filter(Boolean),
  };
}

export function upgradeStarGift({
  inputSavedGift,
  shouldKeepOriginalDetails,
}: {
  inputSavedGift: ApiRequestInputSavedStarGift;
  shouldKeepOriginalDetails?: true;
}) {
  return invokeRequest(new GramJs.payments.UpgradeStarGift({
    stargift: buildInputSavedStarGift(inputSavedGift),
    keepOriginalDetails: shouldKeepOriginalDetails,
  }), {
    shouldReturnTrue: true,
  });
}

export function transferStarGift({
  inputSavedGift,
  toPeer,
}: {
  inputSavedGift: ApiRequestInputSavedStarGift;
  toPeer: ApiPeer;
}) {
  return invokeRequest(new GramJs.payments.TransferStarGift({
    stargift: buildInputSavedStarGift(inputSavedGift),
    toId: buildInputPeer(toPeer.id, toPeer.accessHash),
  }), {
    shouldReturnTrue: true,
  });
}

export function toggleSavedGiftPinned({
  inputSavedGifts,
  peer,
}: {
  inputSavedGifts: ApiRequestInputSavedStarGift[];
  peer: ApiPeer;
}) {
  return invokeRequest(new GramJs.payments.ToggleStarGiftsPinnedToTop({
    stargift: inputSavedGifts.map(buildInputSavedStarGift),
    peer: buildInputPeer(peer.id, peer.accessHash),
  }), {
    shouldReturnTrue: true,
  });
}

export function updateStarGiftPrice({
  inputSavedGift,
  price,
}: {
  inputSavedGift: ApiRequestInputSavedStarGift;
  price: ApiTypeCurrencyAmount;
}) {
  return invokeRequest(new GramJs.payments.UpdateStarGiftPrice({
    stargift: buildInputSavedStarGift(inputSavedGift),
    resellAmount: buildInputStarsAmount(price),
  }), {
    shouldReturnTrue: true,
  });
}

export async function fetchUniqueStarGiftValueInfo({ slug }: { slug: string }) {
  const result = await invokeRequest(new GramJs.payments.GetUniqueStarGiftValueInfo({
    slug,
  }));

  if (!result) {
    return undefined;
  }

  return buildApiUniqueStarGiftValueInfo(result);
}

export async function fetchStarGiftWithdrawalUrl({
  inputGift,
  password,
}: {
  inputGift: ApiRequestInputSavedStarGift;
  password: string;
}) {
  try {
    const tmpPasswordResult = await getTemporaryPaymentPassword(password);

    if (!tmpPasswordResult) {
      return undefined;
    }

    if ('error' in tmpPasswordResult) {
      return tmpPasswordResult;
    }

    const result = await invokeRequest(new GramJs.payments.GetStarGiftWithdrawalUrl({
      stargift: buildInputSavedStarGift(inputGift),
      tmpPassword: tmpPasswordResult.tmpPassword,
    }), {
      shouldThrow: true,
    });

    if (!result) {
      return undefined;
    }

    return { url: result.url };
  } catch (err: unknown) {
    if (!checkErrorType(err)) return undefined;

    return wrapError(err);
  }

  return undefined;
}

export async function fetchStarGiftCollections({
  peer,
  hash,
}: {
  peer: ApiPeer;
  hash?: string;
}) {
  const result = await invokeRequest(new GramJs.payments.GetStarGiftCollections({
    peer: buildInputPeer(peer.id, peer.accessHash),
    hash: hash ? BigInt(hash) : DEFAULT_PRIMITIVES.BIGINT,
  }));

  if (!result || result instanceof GramJs.payments.StarGiftCollectionsNotModified) {
    return undefined;
  }

  return {
    collections: result.collections.map(buildApiStarGiftCollection).filter(Boolean),
  };
}

export function resolveStarGiftOffer({
  offerMsgId,
  shouldDecline,
}: {
  offerMsgId: number;
  shouldDecline?: boolean;
}) {
  return invokeRequest(new GramJs.payments.ResolveStarGiftOffer({
    offerMsgId,
    decline: shouldDecline || undefined,
  }), {
    shouldReturnTrue: true,
  });
}

export async function fetchCraftStarGifts({
  giftId,
  peerId,
  offset = DEFAULT_PRIMITIVES.STRING,
  limit = DEFAULT_PRIMITIVES.INT,
}: {
  giftId: string;
  peerId: string;
  offset?: string;
  limit?: number;
}) {
  const result = await invokeRequest(new GramJs.payments.GetCraftStarGifts({
    giftId: BigInt(giftId),
    offset,
    limit,
  }));

  if (!result) {
    return undefined;
  }

  return {
    gifts: result.gifts.map((g) => buildApiSavedStarGift(g, peerId)),
    nextOffset: result.nextOffset,
    count: result.count,
  };
}

export async function craftStarGift({
  inputSavedGifts,
}: {
  inputSavedGifts: ApiRequestInputSavedStarGift[];
}) {
  try {
    await invokeRequest(new GramJs.payments.CraftStarGift({
      stargift: inputSavedGifts.map(buildInputSavedStarGift),
    }), {
      shouldThrow: true,
    });
    return undefined;
  } catch (err) {
    if (err instanceof RPCError) {
      return { error: err.errorMessage };
    }
    throw err;
  }
}

export async function fetchStarGiftUpgradeAttributes({
  giftId,
}: {
  giftId: string;
}) {
  const result = await invokeRequest(new GramJs.payments.GetStarGiftUpgradeAttributes({
    giftId: BigInt(giftId),
  }));

  if (!result) {
    return undefined;
  }

  return {
    attributes: result.attributes.map(buildApiStarGiftAttribute).filter(Boolean),
  };
}
