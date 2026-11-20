import { Api as GramJs } from '../../../lib/gramjs';

import type {
  ApiBoostsStatus,
  ApiCheckedGiftCode,
  ApiGiveawayInfo,
  ApiInvoice,
  ApiLabeledPrice,
  ApiMyBoost,
  ApiPaymentCredentials,
  ApiPaymentForm,
  ApiPaymentSavedInfo,
  ApiPremiumGiftCodeOption,
  ApiPremiumPromo,
  ApiPremiumSection,
  ApiPremiumSubscriptionOption,
  ApiPrepaidGiveaway,
  ApiPrepaidStarsGiveaway,
  ApiStarGiveawayOption,
  ApiStarsGiveawayWinnerOption,
  ApiTypeCurrencyAmount,
  ApiUniqueStarGiftValueInfo,
} from '../../types';

import { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../../../config';
import { toJSNumber } from '../../../util/numbers';
import { addWebDocumentToLocalDb } from '../helpers/localDb';
import { buildApiMessageEntity } from './common';
import { omitVirtualClassFields } from './helpers';
import { buildApiDocument, buildApiWebDocument } from './messageContent';
import { buildApiPeerId, getApiChatIdFromMtpPeer } from './peers';

export function buildApiPaymentForm(form: GramJs.payments.TypePaymentForm): ApiPaymentForm {
  if (form instanceof GramJs.payments.PaymentFormStarGift) {
    const { formId } = form;
    return {
      type: 'stargift',
      formId: String(formId),
      invoice: buildApiInvoice(form.invoice),
    };
  }

  if (form instanceof GramJs.payments.PaymentFormStars) {
    const {
      botId, formId, title, description, photo,
    } = form;

    if (photo) {
      addWebDocumentToLocalDb(photo);
    }

    return {
      type: 'stars',
      botId: buildApiPeerId(botId, 'user'),
      formId: String(formId),
      title,
      description,
      photo: buildApiWebDocument(photo),
      invoice: buildApiInvoice(form.invoice),
    };
  }

  const {
    formId,
    canSaveCredentials,
    passwordMissing: isPasswordMissing,
    providerId,
    nativeProvider,
    nativeParams,
    savedInfo,
    invoice,
    savedCredentials,
    url,
    botId,
    description,
    title,
    photo,
  } = form;

  if (photo) {
    addWebDocumentToLocalDb(photo);
  }
  const { shippingAddress } = savedInfo || {};
  const cleanedInfo: ApiPaymentSavedInfo | undefined = savedInfo ? omitVirtualClassFields(savedInfo) : undefined;
  if (cleanedInfo && shippingAddress) {
    cleanedInfo.shippingAddress = omitVirtualClassFields(shippingAddress);
  }

  const nativeData = nativeParams ? JSON.parse(nativeParams.data) : {};

  return {
    type: 'regular',
    title,
    description,
    photo: buildApiWebDocument(photo),
    url,
    botId: buildApiPeerId(botId, 'user'),
    canSaveCredentials,
    isPasswordMissing,
    formId: String(formId),
    providerId: String(providerId),
    nativeProvider,
    savedInfo: cleanedInfo,
    invoice: buildApiInvoice(invoice),
    nativeParams: {
      needCardholderName: Boolean(nativeData?.need_cardholder_name),
      needCountry: Boolean(nativeData?.need_country),
      needZip: Boolean(nativeData?.need_zip),
      publishableKey: nativeData?.publishable_key,
      publicToken: nativeData?.public_token,
      tokenizeUrl: nativeData?.tokenize_url,
    },
    savedCredentials: savedCredentials && buildApiPaymentCredentials(savedCredentials),
  };
}

export function buildApiInvoice(invoice: GramJs.Invoice): ApiInvoice {
  const {
    test,
    currency,
    prices,
    recurring,
    termsUrl,
    maxTipAmount,
    suggestedTipAmounts,
    emailRequested,
    emailToProvider,
    nameRequested,
    phoneRequested,
    phoneToProvider,
    shippingAddressRequested,
    flexible,
  } = invoice;

  const mappedPrices: ApiLabeledPrice[] = prices.map(({ label, amount }) => ({
    label,
    amount: toJSNumber(amount),
  }));

  const totalAmount = prices.reduce((acc, cur) => acc + toJSNumber(cur.amount), 0);
  const totalPrice: ApiTypeCurrencyAmount | undefined = currency === TON_CURRENCY_CODE
    ? { currency: TON_CURRENCY_CODE, amount: prices.reduce((acc, cur) => acc + cur.amount, 0n) }
    : currency === STARS_CURRENCY_CODE ? { currency: STARS_CURRENCY_CODE, amount: totalAmount, nanos: 0 } : undefined;

  return {
    totalAmount,
    totalPrice,
    currency,
    isTest: test,
    isRecurring: recurring,
    termsUrl,
    prices: mappedPrices,
    maxTipAmount: toJSNumber(maxTipAmount),
    suggestedTipAmounts: suggestedTipAmounts?.map((tip) => toJSNumber(tip)),
    isEmailRequested: emailRequested,
    isEmailSentToProvider: emailToProvider,
    isNameRequested: nameRequested,
    isPhoneRequested: phoneRequested,
    isPhoneSentToProvider: phoneToProvider,
    isShippingAddressRequested: shippingAddressRequested,
    isFlexible: flexible,
  };
}

export function buildApiPremiumPromo(promo: GramJs.help.PremiumPromo): ApiPremiumPromo {
  const {
    statusText, statusEntities, videos, videoSections, periodOptions,
  } = promo;

  return {
    statusText,
    statusEntities: statusEntities.map(buildApiMessageEntity),
    videoSections: videoSections as ApiPremiumSection[],
    videos: videos.map(buildApiDocument).filter(Boolean),
    options: periodOptions.map(buildApiPremiumSubscriptionOption),
  };
}

function buildApiPremiumSubscriptionOption(option: GramJs.PremiumSubscriptionOption): ApiPremiumSubscriptionOption {
  const {
    current, canPurchaseUpgrade, currency, amount, botUrl, months,
  } = option;

  return {
    isCurrent: current,
    canPurchaseUpgrade,
    currency,
    amount: toJSNumber(amount),
    botUrl,
    months,
  };
}

export function buildApiPaymentCredentials(credentials: GramJs.PaymentSavedCredentialsCard[]): ApiPaymentCredentials[] {
  return credentials.map(({ id, title }) => ({ id, title }));
}

export function buildPrepaidGiveaway(
  interaction: GramJs.TypePrepaidGiveaway,
): ApiPrepaidGiveaway | ApiPrepaidStarsGiveaway {
  if (interaction instanceof GramJs.PrepaidGiveaway) {
    return {
      type: 'giveaway',
      id: interaction.id.toString(),
      date: interaction.date,
      months: interaction.months,
      quantity: interaction.quantity,
    };
  }

  return {
    type: 'starsGiveaway',
    id: interaction.id.toString(),
    stars: toJSNumber(interaction.stars),
    quantity: interaction.quantity,
    boosts: interaction.boosts,
    date: interaction.date,
  };
}

export function buildApiBoostsStatus(boostStatus: GramJs.premium.BoostsStatus): ApiBoostsStatus {
  const {
    level, boostUrl, boosts,
    giftBoosts, myBoost, currentLevelBoosts, nextLevelBoosts,
    prepaidGiveaways,
  } = boostStatus;

  return {
    level,
    currentLevelBoosts,
    boosts,
    hasMyBoost: Boolean(myBoost),
    boostUrl,
    giftBoosts,
    nextLevelBoosts,
    prepaidGiveaways: prepaidGiveaways?.map((m) => buildPrepaidGiveaway(m)),
  };
}

export function buildApiMyBoost(myBoost: GramJs.MyBoost): ApiMyBoost {
  const {
    date, expires, slot, cooldownUntilDate, peer,
  } = myBoost;

  return {
    date,
    expires,
    slot,
    cooldownUntil: cooldownUntilDate,
    chatId: peer && getApiChatIdFromMtpPeer(peer),
  };
}

export function buildApiGiveawayInfo(info: GramJs.payments.TypeGiveawayInfo): ApiGiveawayInfo | undefined {
  if (info instanceof GramJs.payments.GiveawayInfo) {
    const {
      startDate,
      adminDisallowedChatId,
      disallowedCountry,
      joinedTooEarlyDate,
      participating,
      preparingResults,
    } = info;

    return {
      type: 'active',
      startDate,
      isParticipating: participating,
      adminDisallowedChatId: adminDisallowedChatId !== undefined
        ? buildApiPeerId(adminDisallowedChatId, 'channel') : undefined,
      disallowedCountry,
      joinedTooEarlyDate,
      isPreparingResults: preparingResults,
    };
  } else {
    const {
      activatedCount,
      finishDate,
      giftCodeSlug,
      winner,
      refunded,
      startDate,
      winnersCount,
      starsPrize,
    } = info;

    return {
      type: 'results',
      startDate,
      activatedCount,
      finishDate,
      winnersCount,
      giftCodeSlug,
      isRefunded: refunded,
      isWinner: winner,
      starsPrize: toJSNumber(starsPrize),
    };
  }
}

export function buildApiCheckedGiftCode(giftcode: GramJs.payments.TypeCheckedGiftCode): ApiCheckedGiftCode {
  const {
    date, fromId, days, giveawayMsgId, toId, usedDate, viaGiveaway,
  } = giftcode;

  return {
    date,
    days,
    toId: toId !== undefined ? buildApiPeerId(toId, 'user') : undefined,
    fromId: fromId && getApiChatIdFromMtpPeer(fromId),
    usedAt: usedDate,
    isFromGiveaway: viaGiveaway,
    giveawayMessageId: giveawayMsgId,
  };
}

export function buildApiPremiumGiftCodeOption(option: GramJs.PremiumGiftCodeOption): ApiPremiumGiftCodeOption {
  const {
    amount, currency, months, users,
  } = option;

  return {
    amount: toJSNumber(amount),
    currency,
    months,
    users,
  };
}

export function buildApiCurrencyAmount(amount: GramJs.TypeStarsAmount): ApiTypeCurrencyAmount {
  if (amount instanceof GramJs.StarsAmount) {
    return {
      currency: STARS_CURRENCY_CODE,
      amount: toJSNumber(amount.amount),
      nanos: amount.nanos,
    };
  }

  if (amount instanceof GramJs.StarsTonAmount) {
    return {
      currency: TON_CURRENCY_CODE,
      amount: amount.amount,
    };
  }

  const _exhaustive: never = amount;
  return _exhaustive;
}

export function buildApiStarsGiveawayWinnersOption(
  option: GramJs.StarsGiveawayWinnersOption,
): ApiStarsGiveawayWinnerOption {
  const {
    default: isDefault, users, perUserStars,
  } = option;

  return {
    isDefault,
    users,
    perUserStars: toJSNumber(perUserStars),
  };
}

export function buildApiStarsGiveawayOptions(option: GramJs.StarsGiveawayOption): ApiStarGiveawayOption {
  const {
    extended, default: isDefault, stars, yearlyBoosts, amount, winners, currency,
  } = option;

  const winnerList = winners?.map((m) => buildApiStarsGiveawayWinnersOption(m)).filter(Boolean);

  return {
    isExtended: extended,
    isDefault,
    yearlyBoosts,
    stars: toJSNumber(stars),
    amount: toJSNumber(amount),
    currency,
    winners: winnerList,
  };
}

export function buildApiUniqueStarGiftValueInfo(
  info: GramJs.payments.UniqueStarGiftValueInfo): ApiUniqueStarGiftValueInfo {
  const {
    lastSaleOnFragment, currency, value, initialSaleDate, initialSaleStars, initialSalePrice,
    lastSaleDate, lastSalePrice, floorPrice, averagePrice, listedCount, fragmentListedCount,
    fragmentListedUrl, valueIsAverage,
  } = info;

  return {
    isLastSaleOnFragment: lastSaleOnFragment,
    isValueAverage: valueIsAverage,
    currency,
    value: toJSNumber(value),
    initialSaleDate,
    initialSaleStars: toJSNumber(initialSaleStars),
    initialSalePrice: toJSNumber(initialSalePrice),
    lastSaleDate,
    lastSalePrice: toJSNumber(lastSalePrice),
    floorPrice: toJSNumber(floorPrice),
    averagePrice: toJSNumber(averagePrice),
    listedCount,
    fragmentListedCount,
    fragmentListedUrl,
  };
}
