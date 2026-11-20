import { Api as GramJs } from '../../../lib/gramjs';

import type {
  ApiBoostsStatus,
  ApiGiveawayInfo,
  ApiMyBoost,
  ApiPremiumGiftCodeOption,
  ApiPremiumPromo,
  ApiPremiumSection,
  ApiPremiumSubscriptionOption,
  ApiPrepaidGiveaway,
  ApiPrepaidStarsGiveaway,
  ApiStarGiveawayOption,
  ApiStarsGiveawayWinnerOption,
  ApiTypeCurrencyAmount,
} from '../../types';

import { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../../../config';
import { toJSNumber } from '../../../util/numbers';
import { buildApiMessageEntity } from './common';
import { buildApiDocument } from './messageContent';
import { buildApiPeerId, getApiChatIdFromMtpPeer } from './peers';

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
