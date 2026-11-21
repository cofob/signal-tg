import type { ApiPhoto, ApiReaction } from './messages';

export interface ApiPeerPhotos {
  fallbackPhoto?: ApiPhoto;
  personalPhoto?: ApiPhoto;
  photos: ApiPhoto[];
  count: number;
  nextOffset?: number;
  isLoading?: boolean;
}

export type ApiFakeType = 'fake' | 'scam';

export type ApiEmojiStatusType = ApiEmojiStatus | ApiEmojiStatusCollectible;

export interface ApiEmojiStatus {
  type: 'regular';
  documentId: string;
  until?: number;
}

export interface ApiEmojiStatusCollectible {
  type: 'collectible';
  collectibleId: string;
  documentId: string;
  title: string;
  slug: string;
  patternDocumentId: string;
  centerColor: string;
  edgeColor: string;
  patternColor: string;
  textColor: string;
  until?: number;
}

export interface ApiPeerSettings {
  // A Signal message request: the bar offers accepting, deleting, blocking and reporting
  isMessageRequest?: boolean;
  isAutoArchived?: boolean;
  canReportSpam?: boolean;
  canAddContact?: boolean;
  canBlockContact?: boolean;
  registrationMonth?: string;
  phoneCountry?: string;
  nameChangeDate?: number;
  photoChangeDate?: number;
}

export interface ApiSendAsPeerId {
  id: string;
  isPremium?: boolean;
}

export interface ApiPeerColor {
  type: 'regular';
  color?: number;
  backgroundEmojiId?: string;
}

export type ApiTypePeerColor = ApiPeerColor;

export type ApiPeerColorSet = string[];
export type ApiPeerProfileColorSet = {
  paletteColors: string[];
  bgColors: string[];
  storyColors: string[];
};

export type ApiPeerColorOption<T extends ApiPeerColorSet | ApiPeerProfileColorSet> = {
  isHidden?: true;
  colors?: T;
  darkColors?: T;
};

export interface ApiPeerColors {
  general: Record<number, ApiPeerColorOption<ApiPeerColorSet>>;
  generalHash?: number;
  profile: Record<number, ApiPeerColorOption<ApiPeerProfileColorSet>>;
  profileHash?: number;
}

export type ApiProfileTab = 'stories' | 'media' | 'documents' | 'audio' | 'voice' | 'links' | 'gif';

export interface ApiShareThemeEmojiBackdrop {
  type: 'emojiBackdrop';
  backdropId?: number;
  emojis: ApiReaction[];
}

export type ApiShareTheme = ApiShareThemeEmojiBackdrop;

export type ApiRequestInputShareTheme = ApiShareThemeEmojiBackdrop;

export interface ApiShareThemeBackdrop {
  backdropId: number;
  name: string;
  centerColor: string;
  edgeColor: string;
  patternColor: string;
  textColor: string;
}
