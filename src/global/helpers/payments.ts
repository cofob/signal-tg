import type {
  ApiInputInvoice,
  ApiInputSavedStarGift,
  ApiRequestInputInvoice,
  ApiRequestInputSavedStarGift,
  ApiStarsAmount,
  ApiTypeCurrencyAmount,
} from '../../api/types';
import type { LangFn } from '../../util/localization';
import type { GlobalState } from '../types';

import { STARS_CURRENCY_CODE, TON_CURRENCY_CODE } from '../../config';
import { areRecordsShallowEqual } from '../../util/areShallowEqual';
import { convertTonFromNanos } from '../../util/formatCurrency';
import { selectChat, selectPeer, selectUser } from '../selectors';

export function getRequestInputInvoice<T extends GlobalState>(
  global: T, inputInvoice: ApiInputInvoice,
): ApiRequestInputInvoice | undefined {
  if (inputInvoice.type === 'stargiftResale') {
    const {
      slug,
      peerId,
    } = inputInvoice;
    const peer = selectPeer(global, peerId);

    if (!peer) return undefined;

    return {
      type: 'stargiftResale',
      slug,
      peer,
      currency: inputInvoice.currency,
      message: inputInvoice.message,
      shouldShowName: inputInvoice.shouldShowName,
    };
  }

  if (inputInvoice.type === 'stargift') {
    const {
      peerId, shouldHideName, giftId, message, shouldUpgrade,
    } = inputInvoice;
    const peer = selectPeer(global, peerId);

    if (!peer) return undefined;

    return {
      type: 'stargift',
      peer,
      shouldHideName,
      giftId,
      message,
      shouldUpgrade,
    };
  }

  if (inputInvoice.type === 'premiumGiftStars') {
    const {
      months, userId, message,
    } = inputInvoice;
    const user = selectUser(global, userId);

    if (!user) return undefined;

    return {
      type: 'premiumGiftStars',
      months,
      message,
      user,
    };
  }

  if (inputInvoice.type === 'giftcode') {
    const {
      userIds, boostChannelId, amount, currency, option, message,
    } = inputInvoice;
    const users = userIds.map((id) => selectUser(global, id)).filter(Boolean);
    const boostChannel = boostChannelId ? selectChat(global, boostChannelId) : undefined;

    return {
      type: 'giveaway',
      option,
      purpose: {
        type: 'giftcode',
        amount,
        currency,
        users,
        boostChannel,
        message,
      },
    };
  }

  if (inputInvoice.type === 'starsgiveaway') {
    const {
      chatId, additionalChannelIds, amount, currency, untilDate, areWinnersVisible, countries,
      isOnlyForNewSubscribers, prizeDescription, stars, users,
    } = inputInvoice;
    const chat = selectChat(global, chatId);
    if (!chat) {
      return undefined;
    }
    const additionalChannels = additionalChannelIds?.map((id) => selectChat(global, id)).filter(Boolean);

    return {
      type: 'starsgiveaway',
      purpose: {
        type: 'starsgiveaway',
        amount,
        currency,
        chat,
        additionalChannels,
        untilDate,
        areWinnersVisible,
        countries,
        isOnlyForNewSubscribers,
        prizeDescription,
        stars,
        users,
      },
    };
  }

  if (inputInvoice.type === 'giveaway') {
    const {
      chatId, additionalChannelIds, amount, currency, option, untilDate, areWinnersVisible, countries,
      isOnlyForNewSubscribers, prizeDescription,
    } = inputInvoice;
    const chat = selectChat(global, chatId);
    if (!chat) {
      return undefined;
    }
    const additionalChannels = additionalChannelIds?.map((id) => selectChat(global, id)).filter(Boolean);

    return {
      type: 'giveaway',
      option,
      purpose: {
        type: 'giveaway',
        amount,
        currency,
        chat,
        additionalChannels,
        untilDate,
        areWinnersVisible,
        countries,
        isOnlyForNewSubscribers,
        prizeDescription,
      },
    };
  }

  if (inputInvoice.type === 'stargiftUpgrade') {
    const { inputSavedGift, shouldKeepOriginalDetails } = inputInvoice;
    const savedGift = getRequestInputSavedStarGift(global, inputSavedGift);
    if (!savedGift) return undefined;

    return {
      type: 'stargiftUpgrade',
      inputSavedGift: savedGift,
      shouldKeepOriginalDetails,
    };
  }

  if (inputInvoice.type === 'stargiftTransfer') {
    const { inputSavedGift, recipientId } = inputInvoice;
    const savedGift = getRequestInputSavedStarGift(global, inputSavedGift);
    const peer = selectPeer(global, recipientId);
    if (!savedGift || !peer) return undefined;

    return {
      type: 'stargiftTransfer',
      inputSavedGift: savedGift,
      recipient: peer,
    };
  }

  if (inputInvoice.type === 'stargiftDropOriginalDetails') {
    const { inputSavedGift } = inputInvoice;
    const savedGift = getRequestInputSavedStarGift(global, inputSavedGift);
    if (!savedGift) return undefined;

    return {
      type: 'stargiftDropOriginalDetails',
      inputSavedGift: savedGift,
    };
  }

  if (inputInvoice.type === 'stargiftPrepaidUpgrade') {
    const { peerId, hash } = inputInvoice;
    const peer = selectPeer(global, peerId);
    if (!peer) return undefined;

    return {
      type: 'stargiftPrepaidUpgrade',
      peer,
      hash,
    };
  }

  if (inputInvoice.type === 'stargiftAuctionBid') {
    const {
      giftId, bidAmount, peerId, message, shouldHideName, isUpdateBid,
    } = inputInvoice;
    const peer = peerId ? selectPeer(global, peerId) : undefined;

    return {
      type: 'stargiftAuctionBid',
      giftId,
      bidAmount,
      peer,
      message,
      shouldHideName,
      isUpdateBid,
    };
  }

  return undefined;
}

export function getRequestInputSavedStarGift<T extends GlobalState>(
  global: T, inputGift: ApiInputSavedStarGift,
): ApiRequestInputSavedStarGift | undefined {
  if (inputGift.type === 'user') return inputGift;

  if (inputGift.type === 'chat') {
    const chat = selectChat(global, inputGift.chatId);
    if (!chat) return undefined;

    return {
      type: 'chat',
      chat,
      savedId: inputGift.savedId,
    };
  }

  return undefined;
}

export function formatStarsTransactionAmount(lang: LangFn, currencyAmount: ApiTypeCurrencyAmount) {
  if (currencyAmount.currency === STARS_CURRENCY_CODE) {
    const amount = currencyAmount.amount + currencyAmount.nanos / 1e9;
    if (amount < 0) {
      return `- ${lang.number(Math.abs(amount))}`;
    }

    return `+ ${lang.number(amount)}`;
  }

  if (currencyAmount.currency === TON_CURRENCY_CODE) {
    const amount = convertTonFromNanos(currencyAmount.amount);
    const absAmount = Math.abs(amount);

    if (amount < 0) {
      return `- ${lang.preciseNumber(absAmount)}`;
    }

    return `+ ${lang.preciseNumber(absAmount)}`;
  }

  return undefined;
}

export function areInputSavedGiftsEqual(one: ApiInputSavedStarGift, two: ApiInputSavedStarGift) {
  return areRecordsShallowEqual(one, two);
}

export function buildStarsAmount(amount: number): ApiStarsAmount {
  return { currency: STARS_CURRENCY_CODE, amount, nanos: 0 };
}

export function areCurrencyAmountsEqual(one?: ApiTypeCurrencyAmount, two?: ApiTypeCurrencyAmount) {
  if (one?.currency === STARS_CURRENCY_CODE && two?.currency === STARS_CURRENCY_CODE) {
    return one.amount === two.amount && one.nanos === two.nanos;
  }

  return one?.currency === two?.currency && one?.amount === two?.amount;
}
