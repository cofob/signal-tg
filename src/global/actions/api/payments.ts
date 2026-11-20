import type {
  ActionReturnType,
} from '../../types';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { getServerTime } from '../../../util/serverTime';
import { callApi } from '../../../api/gramjs';
import { isChatChannel, isChatSuperGroup } from '../../helpers';
import {
  addActionHandler, getGlobal, setGlobal,
} from '../../index';
import {
  updateChatFullInfo,
} from '../../reducers';
import { updateTabState } from '../../reducers/tabs';
import {
  selectChat,
  selectChatFullInfo,
  selectTabState,
} from '../../selectors';

const LOCAL_BOOST_COOLDOWN = 86400; // 24 hours

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
    initialSection, fromUserId, isSuccess, isGift, daysAmount, toUserId,
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
