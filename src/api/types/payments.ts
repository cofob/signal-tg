import type { PREMIUM_FEATURE_SECTIONS } from '../../config';
import type {
  ApiDocument,
  ApiMessageEntity,
} from './messages';

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
