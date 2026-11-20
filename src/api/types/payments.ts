import type { PREMIUM_FEATURE_SECTIONS } from '../../config';
import type { ApiChat } from './chats';
import type {
  ApiDocument,
  ApiMessageEntity,
} from './messages';
import type { ApiStarsGiveawayWinnerOption } from './stars';

export type ApiPremiumSection = typeof PREMIUM_FEATURE_SECTIONS[number];

// Video sections can include additional values like 'gifts' that are not premium features
export type ApiPromoVideoSection = ApiPremiumSection | 'gifts';

export interface ApiPremiumPromo {
  videoSections: ApiPromoVideoSection[];
  videos: ApiDocument[];
  statusText: string;
  statusEntities: ApiMessageEntity[];
  options: ApiPremiumSubscriptionOption[];
}

export interface ApiPremiumSubscriptionOption {
  isCurrent?: boolean;
  canPurchaseUpgrade?: boolean;
  months: number;
  currency: string;
  amount: number;
  botUrl: string;
}

export type ApiInputStorePaymentGiveaway = {
  type: 'giveaway';
  isOnlyForNewSubscribers?: boolean;
  areWinnersVisible?: boolean;
  chat: ApiChat;
  additionalChannels?: ApiChat[];
  countries?: string[];
  prizeDescription?: string;
  untilDate: number;
  currency: string;
  amount: number;
};

export type ApiInputStorePaymentStarsGiveaway = {
  type: 'starsgiveaway';
  isOnlyForNewSubscribers?: boolean;
  areWinnersVisible?: boolean;
  chat: ApiChat;
  additionalChannels?: ApiChat[];
  stars?: number;
  countries?: string[];
  prizeDescription?: string;
  untilDate: number;
  currency: string;
  amount: number;
  users: number;
};

export type ApiInputStorePaymentPurpose = ApiInputStorePaymentGiveaway | ApiInputStorePaymentStarsGiveaway;

export interface ApiPremiumGiftCodeOption {
  users: number;
  months: number;
  currency: string;
  amount: number;
}

export interface ApiPrepaidGiveaway {
  type: 'giveaway';
  id: string;
  months: number;
  quantity: number;
  date: number;
}

export type ApiPrepaidStarsGiveaway = {
  type: 'starsGiveaway';
  id: string;
  stars: number;
  quantity: number;
  boosts: number;
  date: number;
};

export type ApiTypePrepaidGiveaway = ApiPrepaidGiveaway | ApiPrepaidStarsGiveaway;

export type ApiBoostsStatus = {
  level: number;
  currentLevelBoosts: number;
  boosts: number;
  nextLevelBoosts?: number;
  hasMyBoost?: boolean;
  boostUrl: string;
  giftBoosts?: number;
  prepaidGiveaways?: ApiTypePrepaidGiveaway[];
};

export type ApiMyBoost = {
  slot: number;
  chatId?: string;
  date: number;
  expires: number;
  cooldownUntil?: number;
};

export type ApiGiveawayInfoActive = {
  type: 'active';
  isParticipating?: true;
  isPreparingResults?: true;
  startDate: number;
  joinedTooEarlyDate?: number;
  adminDisallowedChatId?: string;
  disallowedCountry?: string;
};

export type ApiGiveawayInfoResults = {
  type: 'results';
  isWinner?: true;
  isRefunded?: true;
  startDate: number;
  starsPrize?: number;
  finishDate: number;
  giftCodeSlug?: string;
  winnersCount: number;
  activatedCount?: number;
};

export type ApiGiveawayInfo = ApiGiveawayInfoActive | ApiGiveawayInfoResults;

export interface ApiStarGiveawayOption {
  isExtended?: true;
  isDefault?: true;
  stars: number;
  yearlyBoosts: number;
  currency: string;
  amount: number;
  winners: ApiStarsGiveawayWinnerOption[];
}
