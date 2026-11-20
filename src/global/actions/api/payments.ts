import type {
  ApiInputInvoice, ApiInputInvoicePremiumGiftStars, ApiInputInvoiceStarGift,
  ApiInputInvoiceStarGiftAuctionBid, ApiInputInvoiceStarGiftResale, ApiTypeCurrencyAmount,
} from '../../../api/types';
import type {
  ActionReturnType, GlobalState, TabArgs,
} from '../../types';

import { TON_CURRENCY_CODE } from '../../../config';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { getServerTime } from '../../../util/serverTime';
import { extractCurrentThemeParams } from '../../../util/themeStyle';
import { callApi } from '../../../api/gramjs';
import { isChatChannel, isChatSuperGroup } from '../../helpers';
import {
  areCurrencyAmountsEqual,
  buildStarsAmount,
  getRequestInputInvoice,
  getRequestInputSavedStarGift,
} from '../../helpers/payments';
import {
  addActionHandler, getActions, getGlobal, setGlobal,
} from '../../index';
import {
  updateChatFullInfo,
} from '../../reducers';
import { updateTabState } from '../../reducers/tabs';
import {
  selectChat,
  selectChatFullInfo,
  selectIsCurrentUserFrozen,
  selectTabState,
} from '../../selectors';

const LOCAL_BOOST_COOLDOWN = 86400; // 24 hours

addActionHandler('sendStarGift', (global, actions, payload): ActionReturnType => {
  const {
    gift, peerId, message, shouldHideName, shouldUpgrade, tabId = getCurrentTabId(),
  } = payload;

  const inputInvoice: ApiInputInvoiceStarGift = {
    type: 'stargift',
    peerId,
    giftId: gift.id,
    message,
    shouldHideName,
    shouldUpgrade: shouldUpgrade || undefined,
  };

  payInputStarInvoice(global, inputInvoice, buildStarsAmount(gift.stars), tabId);
});

addActionHandler('buyStarGift', (global, actions, payload): ActionReturnType => {
  const {
    slug, peerId, price, message, shouldShowName, tabId = getCurrentTabId(),
  } = payload;

  const inputInvoice: ApiInputInvoiceStarGiftResale = {
    type: 'stargiftResale',
    slug,
    peerId,
    currency: price.currency,
    message,
    shouldShowName,
  };

  payInputStarInvoice(global, inputInvoice, price, tabId);
});

addActionHandler('sendPremiumGiftByStars', (global, actions, payload): ActionReturnType => {
  const {
    userId, months, amount, message, tabId = getCurrentTabId(),
  } = payload;

  const inputInvoice: ApiInputInvoicePremiumGiftStars = {
    type: 'premiumGiftStars',
    userId,
    months,
    message,
  };

  payInputStarInvoice(global, inputInvoice, buildStarsAmount(amount), tabId);
});

addActionHandler('sendStarPaymentForm', async (global, actions, payload): Promise<void> => {
  const { directInfo: { inputInvoice, formId }, tabId = getCurrentTabId() } = payload;

  const requestInputInvoice = getRequestInputInvoice(global, inputInvoice);
  if (!requestInputInvoice) {
    return;
  }

  const result = await callApi('sendStarPaymentForm', {
    inputInvoice: requestInputInvoice,
    formId,
  });

  if (!result) {
    actions.closeGiftModal({ tabId });
    return;
  }

  actions.apiUpdate({
    '@type': 'updateStarPaymentStateCompleted',
    paymentState: { inputInvoice },
    tabId,
  });
  actions.loadStarStatus();
});

addActionHandler('closePremiumModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  const tabState = selectTabState(global, tabId);
  if (!tabState.premiumModal) return undefined;
  return updateTabState(global, {
    premiumModal: {
      promo: tabState.premiumModal.promo, // Cache promo
      isOpen: false,
    },
  }, tabId);
});

addActionHandler('openPremiumModal', async (global, actions, payload): Promise<void> => {
  const {
    initialSection, fromUserId, isSuccess, isGift, daysAmount, toUserId, gift,
    tabId = getCurrentTabId(),
  } = payload || {};

  actions.loadPremiumStickers();

  const result = await callApi('fetchPremiumPromo');
  if (!result) return;

  global = getGlobal();

  global = updateTabState(global, {
    premiumModal: {
      promo: result.promo,
      initialSection,
      isOpen: true,
      fromUserId,
      toUserId,
      isGift,
      daysAmount,
      isSuccess,
      gift,
    },
  }, tabId);
  setGlobal(global);

  actions.closeReactionPicker({ tabId });
});

addActionHandler('openGiveawayModal', async (global, actions, payload): Promise<void> => {
  const {
    chatId, prepaidGiveaway,
    tabId = getCurrentTabId(),
  } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) return;

  const result = await callApi('getPremiumGiftCodeOptions', {
    chat,
  });

  const starOptions = await callApi('fetchStarsGiveawayOptions');

  if (!result || !starOptions) {
    return;
  }

  global = getGlobal();

  global = updateTabState(global, {
    giveawayModal: {
      chatId,
      gifts: result,
      isOpen: true,
      prepaidGiveaway,
      starOptions,
    },
  }, tabId);
  setGlobal(global);
});

addActionHandler('checkCanSendGift', async (global, actions, payload): Promise<void> => {
  const {
    gift, onSuccess, tabId = getCurrentTabId(),
  } = payload;

  if (gift.type !== 'starGift' || !gift.lockedUntilDate) {
    onSuccess();
    return;
  }

  const result = await callApi('fetchCheckCanSendGift', {
    giftId: gift.id,
  });

  if (!result) return;

  if (result?.canSend) {
    onSuccess();
  } else {
    actions.openLockedGiftModalInfo({
      untilDate: gift.type === 'starGift' ? gift.lockedUntilDate : undefined,
      reason: result.reason,
      tabId,
    });
  }
});

addActionHandler('openGiftModal', async (global, actions, payload): Promise<void> => {
  const {
    forUserId, selectedGift, selectedResaleGift, tabId = getCurrentTabId(),
  } = payload;

  if (selectIsCurrentUserFrozen(global)) {
    actions.openFrozenAccountModal({ tabId });
    return;
  }

  const gifts = await callApi('getPremiumGiftCodeOptions', {});
  if (!gifts) return;

  global = getGlobal();
  global = updateTabState(global, {
    giftModal: {
      forPeerId: forUserId,
      gifts,
      selectedResaleGift,
      selectedGift,
    },
  }, tabId);
  setGlobal(global);
});

addActionHandler('openBoostModal', async (global, actions, payload): Promise<void> => {
  const { chatId, tabId = getCurrentTabId() } = payload;
  const chat = selectChat(global, chatId);
  if (!chat || !(isChatChannel(chat) || isChatSuperGroup(chat))) return;

  global = updateTabState(global, {
    boostModal: {
      chatId,
    },
  }, tabId);
  setGlobal(global);

  const result = await callApi('fetchBoostStatus', {
    chat,
  });

  if (!result) {
    actions.closeBoostModal({ tabId });
    return;
  }

  global = getGlobal();
  global = updateTabState(global, {
    boostModal: {
      chatId,
      boostStatus: result,
    },
  }, tabId);
  setGlobal(global);

  const myBoosts = await callApi('fetchMyBoosts');

  if (!myBoosts) return;

  global = getGlobal();
  const tabState = selectTabState(global, tabId);
  if (!tabState.boostModal) return;

  global = updateTabState(global, {
    boostModal: {
      ...tabState.boostModal,
      myBoosts: myBoosts.boosts,
    },
  }, tabId);
  setGlobal(global);
});

addActionHandler('applyBoost', async (global, actions, payload): Promise<void> => {
  const { chatId, slots, tabId = getCurrentTabId() } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) return;

  const oldChatFullInfo = selectChatFullInfo(global, chatId);
  const oldBoostsApplied = oldChatFullInfo?.boostsApplied || 0;

  const appliedBoostsCount = slots.length;

  let tabState = selectTabState(global, tabId);
  const oldStatus = tabState.boostModal?.boostStatus;

  if (oldStatus) {
    const boostsPerLevel = oldStatus.nextLevelBoosts ? oldStatus.nextLevelBoosts - oldStatus.currentLevelBoosts : 1;
    const newBoosts = oldStatus.boosts + appliedBoostsCount;
    const isLevelUp = oldStatus.nextLevelBoosts && newBoosts >= oldStatus.nextLevelBoosts;
    const newCurrentLevelBoosts = isLevelUp ? oldStatus.nextLevelBoosts! : oldStatus.currentLevelBoosts;
    const newNextLevelBoosts = isLevelUp ? oldStatus.nextLevelBoosts! + boostsPerLevel : oldStatus.nextLevelBoosts;

    global = updateTabState(global, {
      boostModal: {
        ...tabState.boostModal!,
        boostStatus: {
          ...oldStatus,
          level: isLevelUp ? oldStatus.level + 1 : oldStatus.level,
          currentLevelBoosts: newCurrentLevelBoosts,
          nextLevelBoosts: newNextLevelBoosts,
          hasMyBoost: true,
          boosts: newBoosts,
        },
      },
    }, tabId);
    setGlobal(global);
  }

  global = getGlobal();
  tabState = selectTabState(global, tabId);
  const oldMyBoosts = tabState.boostModal?.myBoosts;

  if (oldMyBoosts) {
    const unixNow = getServerTime();
    const newMyBoosts = oldMyBoosts.map((boost) => {
      if (slots.includes(boost.slot)) {
        return {
          ...boost,
          chatId,
          date: unixNow,
          cooldownUntil: unixNow + LOCAL_BOOST_COOLDOWN, // Will be refetched below
        };
      }
      return boost;
    });

    global = updateTabState(global, {
      boostModal: {
        ...tabState.boostModal!,
        myBoosts: newMyBoosts,
      },
    }, tabId);
    setGlobal(global);
  }

  const result = await callApi('applyBoost', {
    slots,
    chat,
  });

  global = getGlobal();

  if (!result) {
    // Rollback local changes
    const boostModal = selectTabState(global, tabId).boostModal;
    if (boostModal) {
      global = updateTabState(global, {
        boostModal: {
          ...boostModal,
          boostStatus: oldStatus,
          myBoosts: oldMyBoosts,
        },
      }, tabId);
      setGlobal(global);
    }
    return;
  }

  tabState = selectTabState(global, tabId);
  if (oldChatFullInfo) {
    global = updateChatFullInfo(global, chatId, {
      boostsApplied: oldBoostsApplied + slots.length,
    });
  }

  if (tabState.boostModal) {
    global = updateTabState(global, {
      boostModal: {
        ...tabState.boostModal,
        myBoosts: result.boosts,
      },
    }, tabId);
  }
  setGlobal(global);
});

addActionHandler('checkGiftCode', async (global, actions, payload): Promise<void> => {
  const { slug, message, tabId = getCurrentTabId() } = payload;

  const result = await callApi('checkGiftCode', {
    slug,
  });

  if (!result) {
    actions.showNotification({
      message: {
        key: 'GiftLinkExpired',
        options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
      },
      tabId,
    });
    return;
  }

  global = getGlobal();
  global = updateTabState(global, {
    giftCodeModal: {
      slug,
      info: result.code,
      message,
    },
  }, tabId);
  setGlobal(global);
});

addActionHandler('applyGiftCode', async (global, actions, payload): Promise<void> => {
  const { slug, tabId = getCurrentTabId() } = payload;

  const result = await callApi('applyGiftCode', {
    slug,
  });

  if (!result) {
    return;
  }
  actions.requestConfetti({ withStars: true, tabId });
  actions.closeGiftCodeModal({ tabId });
});

addActionHandler('launchPrepaidGiveaway', async (global, actions, payload): Promise<void> => {
  const {
    chatId, giveawayId, paymentPurpose,
  } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) return;

  const additionalChannels = paymentPurpose?.additionalChannelIds?.map((id) => selectChat(global, id)).filter(Boolean);

  await callApi('launchPrepaidGiveaway', {
    chat,
    giveawayId,
    paymentPurpose: {
      type: 'giveaway',
      chat,
      areWinnersVisible: paymentPurpose?.areWinnersVisible,
      additionalChannels,
      countries: paymentPurpose?.countries,
      prizeDescription: paymentPurpose.prizeDescription,
      untilDate: paymentPurpose.untilDate,
      currency: paymentPurpose.currency,
      amount: paymentPurpose.amount,
    },
  });
});

addActionHandler('launchPrepaidStarsGiveaway', async (global, actions, payload): Promise<void> => {
  const {
    chatId, giveawayId, paymentPurpose,
  } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) return;

  const additionalChannels = paymentPurpose?.additionalChannelIds?.map((id) => selectChat(global, id)).filter(Boolean);

  await callApi('launchPrepaidGiveaway', {
    chat,
    giveawayId,
    paymentPurpose: {
      type: 'starsgiveaway',
      chat,
      areWinnersVisible: paymentPurpose?.areWinnersVisible,
      additionalChannels,
      countries: paymentPurpose?.countries,
      prizeDescription: paymentPurpose.prizeDescription,
      untilDate: paymentPurpose.untilDate,
      currency: paymentPurpose.currency,
      amount: paymentPurpose.amount,
      stars: paymentPurpose.stars,
      users: paymentPurpose.users,
    },
  });
});

addActionHandler('upgradeGift', async (global, actions, payload): Promise<void> => {
  const {
    gift, shouldKeepOriginalDetails, upgradeStars, tabId = getCurrentTabId(),
  } = payload;

  const requestSavedGift = getRequestInputSavedStarGift(global, gift);
  if (!requestSavedGift) {
    return;
  }

  global = updateTabState(global, {
    isWaitingForStarGiftUpgrade: true,
  }, tabId);

  setGlobal(global);
  global = getGlobal();

  actions.closeGiftUpgradeModal({ tabId });
  actions.closeGiftInfoModal({ tabId });

  if (!upgradeStars) {
    const result = await callApi('upgradeStarGift', {
      inputSavedGift: requestSavedGift,
      shouldKeepOriginalDetails: shouldKeepOriginalDetails || undefined,
    });

    global = getGlobal();
    if (result && global.currentUserId) {
      actions.reloadPeerSavedGifts({ peerId: global.currentUserId });
    }

    return;
  }

  const invoice: ApiInputInvoice = {
    type: 'stargiftUpgrade',
    inputSavedGift: gift,
    shouldKeepOriginalDetails: shouldKeepOriginalDetails || undefined,
  };

  payInputStarInvoice(global, invoice, buildStarsAmount(upgradeStars), tabId);
});

addActionHandler('transferGift', (global, actions, payload): ActionReturnType => {
  const {
    gift, recipientId, transferStars, tabId = getCurrentTabId(),
  } = payload;

  const peer = selectChat(global, recipientId);

  const requestSavedGift = getRequestInputSavedStarGift(global, gift);
  if (!peer || !requestSavedGift) {
    return;
  }

  global = updateTabState(global, {
    isWaitingForStarGiftTransfer: true,
  }, tabId);

  setGlobal(global);
  global = getGlobal();

  actions.closeGiftTransferModal({ tabId });
  actions.closeGiftInfoModal({ tabId });

  if (!transferStars) {
    callApi('transferStarGift', {
      inputSavedGift: requestSavedGift,
      toPeer: peer,
    });

    return;
  }

  const invoice: ApiInputInvoice = {
    type: 'stargiftTransfer',
    inputSavedGift: gift,
    recipientId,
  };

  payInputStarInvoice(global, invoice, buildStarsAmount(transferStars), tabId);
});

addActionHandler('removeGiftDescription', (global, actions, payload): ActionReturnType => {
  const { gift, price, tabId = getCurrentTabId() } = payload;

  const invoice: ApiInputInvoice = {
    type: 'stargiftDropOriginalDetails',
    inputSavedGift: gift,
  };

  payInputStarInvoice(global, invoice, buildStarsAmount(price), tabId);
});

addActionHandler('upgradePrepaidGift', (global, actions, payload): ActionReturnType => {
  const { peerId, hash, stars, tabId = getCurrentTabId() } = payload;

  const invoice: ApiInputInvoice = {
    type: 'stargiftPrepaidUpgrade',
    peerId,
    hash,
  };

  payInputStarInvoice(global, invoice, buildStarsAmount(stars), tabId);
});

addActionHandler('sendStarGiftAuctionBid', (global, actions, payload): ActionReturnType => {
  const {
    giftId, bidAmount, peerId, message, shouldHideName, isUpdateBid, tabId = getCurrentTabId(),
  } = payload;

  const invoice: ApiInputInvoiceStarGiftAuctionBid = {
    type: 'stargiftAuctionBid',
    giftId,
    bidAmount,
    peerId,
    message,
    shouldHideName,
    isUpdateBid,
  };

  payInputStarInvoice(global, invoice, buildStarsAmount(bidAmount), tabId);
});

async function payInputStarInvoice<T extends GlobalState>(
  global: T, inputInvoice: ApiInputInvoice, price: ApiTypeCurrencyAmount,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const actions = getActions();
  const balance = price.currency === TON_CURRENCY_CODE ? global.ton?.balance : global.stars?.balance;

  if (balance === undefined) return;

  const requestInputInvoice = getRequestInputInvoice(global, inputInvoice);
  if (!requestInputInvoice) {
    return;
  }

  global = updateTabState(global, {
    isPaymentFormLoading: true,
  }, tabId);
  setGlobal(global);

  const theme = extractCurrentThemeParams();
  const form = await callApi('getPaymentForm', requestInputInvoice, theme);

  if (!form) {
    return;
  }

  global = getGlobal();

  global = updateTabState(global, {
    isPaymentFormLoading: false,
  }, tabId);
  setGlobal(global);

  if ('error' in form) {
    handlePaymentFormError(form.error, tabId);
    return;
  }

  const formPrice = form.invoice.totalPrice;
  if (formPrice && !areCurrencyAmountsEqual(formPrice, price)) {
    actions.openPriceConfirmModal({
      originalAmount: price,
      newAmount: formPrice,
      directInfo: {
        inputInvoice,
        formId: form.formId,
      },
      tabId,
    });
    return;
  }

  actions.sendStarPaymentForm({
    directInfo: {
      inputInvoice,
      formId: form.formId,
    },
    tabId,
  });
}

addActionHandler('openUniqueGiftBySlug', async (global, actions, payload): Promise<void> => {
  const {
    slug, tabId = getCurrentTabId(),
  } = payload;

  const result = await callApi('fetchUniqueStarGift', { slug });

  if (!result || 'error' in result) {
    const isBurned = result && 'error' in result && result.errorMessage === 'STARGIFT_ALREADY_BURNED';
    actions.showNotification({
      message: {
        key: isBurned ? 'ActionStarGiftUniqueBurnedError' : 'GiftWasNotFound',
      },
      tabId,
    });
    return;
  }

  actions.openGiftInfoModal({ gift: result, tabId });
});

addActionHandler('openGiftAuctionBySlug', async (global, actions, payload): Promise<void> => {
  const {
    slug, tabId = getCurrentTabId(),
  } = payload;

  const auctionState = await callApi('fetchStarGiftAuctionState', { slug });

  if (!auctionState) {
    actions.showNotification({
      message: {
        key: 'GiftWasNotFound',
      },
      tabId,
    });
    return;
  }

  actions.openGiftAuctionModal({ gift: auctionState.gift, tabId });
});

addActionHandler('processStarGiftWithdrawal', async (global, actions, payload): Promise<void> => {
  const {
    gift, password, tabId = getCurrentTabId(),
  } = payload;

  let giftWithdrawModal = selectTabState(global, tabId).giftWithdrawModal;
  if (!giftWithdrawModal) return;

  global = updateTabState(global, {
    giftWithdrawModal: {
      ...giftWithdrawModal,
      isLoading: true,
      errorKey: undefined,
    },
  }, tabId);
  setGlobal(global);

  const inputGift = getRequestInputSavedStarGift(global, gift);
  if (!inputGift) {
    return;
  }

  const result = await callApi('fetchStarGiftWithdrawalUrl', { inputGift, password });

  if (!result) {
    return;
  }

  global = getGlobal();
  giftWithdrawModal = selectTabState(global, tabId).giftWithdrawModal;
  if (!giftWithdrawModal) return;

  if ('error' in result) {
    global = updateTabState(global, {
      giftWithdrawModal: {
        ...giftWithdrawModal,
        isLoading: false,
        errorKey: result.messageKey,
      },
    }, tabId);
    setGlobal(global);
    return;
  }

  actions.openUrl({ url: result.url, tabId });
  actions.closeGiftWithdrawModal({ tabId });
});

function handlePaymentFormError(error: string, tabId: number) {
  if (error === 'SLUG_INVALID') {
    getActions().showNotification({
      message: {
        key: 'PaymentInvoiceNotFound',
      },
      tabId,
    });
    return;
  }

  getActions().showDialog({ data: { type: 'error', message: error, hasErrorKey: true }, tabId });
}
