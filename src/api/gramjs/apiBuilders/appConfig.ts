import { Api as GramJs } from '../../../lib/gramjs';

import type { ApiAppConfig } from '../../types';

import { omitUndefined } from '../../../util/iteratees';
import { DEFAULT_APP_CONFIG } from '../../../limits';
import localDb from '../localDb';
import { buildJson } from './misc';

export interface GramJsAppConfig {
  emojies_sounds: Record<string, {
    id: string;
    access_hash: string;
    file_reference_base64: string;
  }>;
  emojies_send_dice: string[];
  emojies_send_dice_success: Record<string, {
    value: number;
    frame_start: number;
  }>;
  groupcall_video_participants_max: number;
  reactions_uniq_max: number;
  chat_read_mark_size_threshold: number;
  chat_read_mark_expire_period: number;
  pm_read_date_expire_period: number;
  reactions_user_max_default: number;
  reactions_user_max_premium: number;
  autologin_domains: string[];
  autologin_token: string;
  url_auth_domains: string[];
  web_app_allowed_protocols?: string[];
  web_widgets_disabled?: boolean;
  whitelisted_domains: string[];
  premium_bot_username: string;
  premium_invoice_slug: string;
  default_emoji_statuses_stickerset_id: string;
  hidden_members_group_size_min: number;
  autoarchive_setting_available: boolean;
  authorization_autoconfirm_period: number;
  stars_paid_reaction_amount_max: number;
  // Forums
  topics_pinned_limit: number;
  // Stories
  story_viewers_expire_period: number;
  stories_changelog_user_id: number;
  stories_pinned_to_top_count_max: number;
  // Boosts
  group_transcribe_level_min?: number;
  new_noncontact_peers_require_premium_without_ownpremium?: boolean;
  channel_revenue_withdrawal_enabled?: boolean;
  // Upload premium notifications
  upload_premium_speedup_notify_period?: number;
  upload_premium_speedup_download?: number;
  upload_premium_speedup_upload?: number;
  starref_start_param_prefixes?: string[];
  ton_blockchain_explorer_url?: string;
  stars_paid_messages_available?: boolean;
  stars_usd_withdraw_rate_x1000?: number;
  stars_usd_sell_rate_x1000?: number;
  stars_paid_message_commission_permille?: number;
  stars_paid_message_amount_max?: number;
  freeze_since_date?: number;
  freeze_until_date?: number;
  freeze_appeal_url?: string;
  channel_autotranslation_level_min?: number;
  stars_suggested_post_amount_max?: number;
  stars_suggested_post_amount_min?: number;
  stars_suggested_post_commission_permille?: number;
  stars_suggested_post_age_min?: number;
  stars_suggested_post_future_max?: number;
  stars_suggested_post_future_min?: number;
  no_forwards_request_expire_period?: number;
  ton_suggested_post_commission_permille?: number;
  ton_suggested_post_amount_max?: number;
  ton_suggested_post_amount_min?: number;
  ton_usd_rate?: number;
  ton_topup_url?: string;
  poll_answers_max?: number;
  poll_close_period_max?: number;
  poll_countries_max?: number;
  phone_country_iso2?: string;
  todo_items_max?: number;
  todo_title_length_max?: number;
  todo_item_length_max?: number;
  quote_length_max?: number;
  ignore_restriction_reasons?: string[];
  need_age_video_verification?: boolean;
  verify_age_bot_username?: string;
  music_search_username?: string;
  verify_age_country?: string;
  verify_age_min?: number;
  message_typing_draft_ttl?: number;
  message_primary_edited_date?: boolean;
  contact_note_length_limit?: number;
  rich_message_length_limit?: number;
  rich_message_max_blocks?: number;
  rich_message_max_depth?: number;
  rich_message_max_media?: number;
  rich_message_max_table_cols?: number;
  whitelisted_bots?: string[];
  settings_display_passkeys?: boolean;
  passkeys_account_passkeys_max?: number;
  aicompose_tone_examples_num?: number;
  aicompose_tone_title_length_max?: number;
  aicompose_tone_prompt_length_max?: number;
  bot_allowed_suffixes?: string[];
}

function buildEmojiSounds(appConfig: GramJsAppConfig) {
  const { emojies_sounds } = appConfig;
  return emojies_sounds ? Object.keys(emojies_sounds).reduce((acc: Record<string, string>, key) => {
    const l = emojies_sounds[key];
    localDb.documents[l.id] = new GramJs.Document({
      id: BigInt(l.id),
      accessHash: BigInt(l.access_hash),
      dcId: 1,
      mimeType: 'audio/ogg',
      fileReference: new Uint8Array(0),
      size: 0n,
    } as GramJs.Document);

    acc[key] = l.id;
    return acc;
  }, {}) : {};
}

function buildDiceEmojiesSuccess(appConfig: GramJsAppConfig) {
  const { emojies_send_dice_success } = appConfig;
  return emojies_send_dice_success ? Object.entries(emojies_send_dice_success).reduce((acc, [key, value]) => {
    acc[key] = {
      value: value.value,
      frameStart: value.frame_start,
    };
    return acc;
  }, {} as ApiAppConfig['diceEmojiesSuccess']) : {};
}

// The config is JSON, so nanotons arrive as doubles and only whole values are taken
function buildNanotons(value?: number) {
  return value !== undefined && Number.isInteger(value) ? BigInt(value) : undefined;
}

export function buildAppConfig(json: GramJs.TypeJSONValue, hash: number): ApiAppConfig {
  const appConfig = buildJson(json) as GramJsAppConfig;

  const config: Partial<ApiAppConfig> = {
    emojiSounds: buildEmojiSounds(appConfig),
    seenByMaxChatMembers: appConfig.chat_read_mark_size_threshold,
    seenByExpiresAt: appConfig.chat_read_mark_expire_period,
    readDateExpiresAt: appConfig.pm_read_date_expire_period,
    autologinDomains: appConfig.autologin_domains || [],
    urlAuthDomains: appConfig.url_auth_domains || [],
    whitelistedDomains: appConfig.whitelisted_domains || [],
    webAppAllowedProtocols: appConfig.web_app_allowed_protocols,
    areWidgetsDisabled: appConfig.web_widgets_disabled,
    maxUniqueReactions: appConfig.reactions_uniq_max,
    premiumBotUsername: appConfig.premium_bot_username,
    defaultEmojiStatusesStickerSetId: appConfig.default_emoji_statuses_stickerset_id,
    topicsPinnedLimit: appConfig.topics_pinned_limit,
    hiddenMembersMinCount: appConfig.hidden_members_group_size_min,
    canDisplayAutoarchiveSetting: appConfig.autoarchive_setting_available,
    richMessageLengthLimit: appConfig.rich_message_length_limit ?? DEFAULT_APP_CONFIG.richMessageLengthLimit,
    richMessageMaxBlocks: appConfig.rich_message_max_blocks ?? DEFAULT_APP_CONFIG.richMessageMaxBlocks,
    richMessageMaxDepth: appConfig.rich_message_max_depth ?? DEFAULT_APP_CONFIG.richMessageMaxDepth,
    richMessageMaxMedia: appConfig.rich_message_max_media ?? DEFAULT_APP_CONFIG.richMessageMaxMedia,
    richMessageMaxTableColumns: appConfig.rich_message_max_table_cols
      ?? DEFAULT_APP_CONFIG.richMessageMaxTableColumns,
    contactNoteLimit: appConfig.contact_note_length_limit,
    hash,
    storyViewersExpirePeriod: appConfig.story_viewers_expire_period,
    storyChangelogUserId: appConfig.stories_changelog_user_id?.toString(),
    maxPinnedStoriesCount: appConfig.stories_pinned_to_top_count_max,
    groupTranscribeLevelMin: appConfig.group_transcribe_level_min,
    canLimitNewMessagesWithoutPremium: appConfig.new_noncontact_peers_require_premium_without_ownpremium,
    starsUsdWithdrawRateX1000: appConfig.stars_usd_withdraw_rate_x1000,
    starsUsdSellRateX1000: appConfig.stars_usd_sell_rate_x1000,
    bandwidthPremiumNotifyPeriod: appConfig.upload_premium_speedup_notify_period,
    bandwidthPremiumUploadSpeedup: appConfig.upload_premium_speedup_upload,
    bandwidthPremiumDownloadSpeedup: appConfig.upload_premium_speedup_download,
    channelAutoTranslationLevelMin: appConfig.channel_autotranslation_level_min,
    isChannelRevenueWithdrawalEnabled: appConfig.channel_revenue_withdrawal_enabled,
    starRefStartPrefixes: appConfig.starref_start_param_prefixes,
    tonExplorerUrl: appConfig.ton_blockchain_explorer_url,
    freezeSinceDate: appConfig.freeze_since_date,
    freezeUntilDate: appConfig.freeze_until_date,
    freezeAppealUrl: appConfig.freeze_appeal_url,
    starsSuggestedPostAmountMax: appConfig.stars_suggested_post_amount_max,
    starsSuggestedPostAmountMin: appConfig.stars_suggested_post_amount_min,
    starsSuggestedPostCommissionPermille: appConfig.stars_suggested_post_commission_permille,
    starsSuggestedPostAgeMin: appConfig.stars_suggested_post_age_min,
    starsSuggestedPostFutureMax: appConfig.stars_suggested_post_future_max,
    starsSuggestedPostFutureMin: appConfig.stars_suggested_post_future_min,
    noForwardsRequestExpirePeriod: appConfig.no_forwards_request_expire_period,
    tonSuggestedPostCommissionPermille: appConfig.ton_suggested_post_commission_permille,
    tonSuggestedPostAmountMax: buildNanotons(appConfig.ton_suggested_post_amount_max),
    tonSuggestedPostAmountMin: buildNanotons(appConfig.ton_suggested_post_amount_min),
    tonUsdRate: appConfig.ton_usd_rate,
    tonTopupUrl: appConfig.ton_topup_url,
    pollMaxAnswers: appConfig.poll_answers_max,
    pollClosePeriodMax: appConfig.poll_close_period_max,
    pollCountriesMax: appConfig.poll_countries_max,
    phoneCountryIso2: appConfig.phone_country_iso2,
    todoItemsMax: appConfig.todo_items_max,
    todoTitleLengthMax: appConfig.todo_title_length_max,
    todoItemLengthMax: appConfig.todo_item_length_max,
    quoteLengthMax: appConfig.quote_length_max,
    ignoreRestrictionReasons: appConfig.ignore_restriction_reasons,
    needAgeVideoVerification: appConfig.need_age_video_verification,
    verifyAgeBotUsername: appConfig.verify_age_bot_username,
    musicSearchUsername: appConfig.music_search_username,
    verifyAgeCountry: appConfig.verify_age_country,
    verifyAgeMin: appConfig.verify_age_min,
    typingDraftTtl: appConfig.message_typing_draft_ttl,
    isMessagePrimaryEditedDateEnabled: appConfig.message_primary_edited_date,
    whitelistedBotIds: appConfig.whitelisted_bots,
    arePasskeysAvailable: appConfig.settings_display_passkeys,
    passkeysMaxCount: appConfig.passkeys_account_passkeys_max,
    diceEmojies: appConfig.emojies_send_dice,
    diceEmojiesSuccess: buildDiceEmojiesSuccess(appConfig),
    aiComposeToneExamplesNum: appConfig.aicompose_tone_examples_num,
    aiComposeToneTitleLengthMax: appConfig.aicompose_tone_title_length_max,
    aiComposeTonePromptLengthMax: appConfig.aicompose_tone_prompt_length_max,
    botAllowedSuffixes: appConfig.bot_allowed_suffixes,
  };

  return {
    ...DEFAULT_APP_CONFIG,
    ...omitUndefined(config),
  };
}
