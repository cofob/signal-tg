import { memo, useEffect } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { ApiLimitTypeWithModal } from '../../../../api/types';
import type { IconName } from '../../../../types/icons';
import type { LangKey } from '../../../../types/language';
import type { LangFn } from '../../../../util/localization';

import { MAX_UPLOAD_FILEPART_SIZE } from '../../../../config';
import { selectIsCurrentUserPremium } from '../../../../global/selectors';
import buildClassName from '../../../../util/buildClassName';
import { formatFileSize } from '../../../../util/text/textFormat';
import renderText from '../../../common/helpers/renderText';

import useFlag from '../../../../hooks/useFlag';
import useLang from '../../../../hooks/useLang';

import Button from '../../../ui/Button';
import Modal from '../../../ui/Modal';

import styles from './PremiumLimitReachedModal.module.scss';

const LIMIT_DESCRIPTION_BLOCKED = {
  dialogFiltersChats: 'LimitReachedChatInFoldersLocked',
  uploadMaxFileparts: 'LimitReachedFileSizeLocked',
  dialogFilters: 'LimitReachedFoldersLocked',
  dialogFolderPinned: 'LimitReachedPinDialogsLocked',
  channelsPublic: 'LimitReachedPublicLinksLocked',
  channels: 'LimitReachedCommunitiesLocked',
  chatlistInvites: 'LimitReachedFolderLinksLocked',
  chatlistJoined: 'LimitReachedSharedFoldersLocked',
  savedDialogsPinned: 'LimitReachedPinDialogsLocked',
} as const satisfies Record<ApiLimitTypeWithModal, LangKey>;

const LIMIT_DESCRIPTION_PREMIUM = {
  dialogFiltersChats: 'LimitReachedChatInFoldersPremium',
  uploadMaxFileparts: 'LimitReachedFileSizePremium',
  dialogFilters: 'LimitReachedFoldersPremium',
  dialogFolderPinned: 'LimitReachedPinDialogsPremium',
  channelsPublic: 'LimitReachedPublicLinksPremium',
  channels: 'LimitReachedCommunitiesPremium',
  chatlistInvites: 'LimitReachedFolderLinksPremium',
  chatlistJoined: 'LimitReachedSharedFoldersPremium',
  savedDialogsPinned: 'LimitReachedPinDialogsPremium',
} as const satisfies Record<ApiLimitTypeWithModal, LangKey>;

const LIMIT_ICON: Record<ApiLimitTypeWithModal, IconName> = {
  dialogFiltersChats: 'chat-badge',
  uploadMaxFileparts: 'file-badge',
  dialogFilters: 'folder-filled',
  dialogFolderPinned: 'pin-filled',
  channelsPublic: 'link-badge',
  channels: 'chats-badge',
  chatlistInvites: 'link-badge',
  chatlistJoined: 'folder-filled',
  savedDialogsPinned: 'pin-filled',
};

const LIMIT_VALUE_FORMATTER: Partial<Record<ApiLimitTypeWithModal, (...args: any[]) => string>> = {
  uploadMaxFileparts: (lang: LangFn, value: number) => {
    // The real size is not exactly 4gb, so we need to round it
    if (value === 8000) return lang('MediaSizeGB', { size: 4 }, { pluralValue: 4 });
    if (value === 4000) return lang('MediaSizeGB', { size: 2 }, { pluralValue: 2 });
    return formatFileSize(lang, value * MAX_UPLOAD_FILEPART_SIZE);
  },
};

function getLimiterDescription({
  lang,
  limitType,
  isPremium,
  defaultValue,
  premiumValue,
  valueFormatter,
}: {
  lang: LangFn;
  limitType?: ApiLimitTypeWithModal;
  isPremium?: boolean;
  defaultValue?: number;
  premiumValue?: number;
  valueFormatter?: (...args: any[]) => string;
}) {
  if (!limitType) {
    return undefined;
  }

  const defaultValueFormatted = valueFormatter ? valueFormatter(lang, defaultValue) : defaultValue;
  const premiumValueFormatted = valueFormatter ? valueFormatter(lang, premiumValue) : premiumValue;

  if (isPremium) {
    return limitType === 'channelsPublic'
      ? lang(LIMIT_DESCRIPTION_PREMIUM[limitType])
      : lang(LIMIT_DESCRIPTION_PREMIUM[limitType], { limit: premiumValueFormatted });
  }

  return limitType === 'channelsPublic'
    ? lang(LIMIT_DESCRIPTION_BLOCKED[limitType])
    : lang(LIMIT_DESCRIPTION_BLOCKED[limitType], { limit: defaultValueFormatted });
}

export type OwnProps = {
  limit?: ApiLimitTypeWithModal;
};

type StateProps = {
  defaultValue?: number;
  premiumValue?: number;
  isPremium?: boolean;
};

const PremiumLimitReachedModal = ({
  defaultValue,
  premiumValue,
  limit,
  isPremium,
}: OwnProps & StateProps) => {
  const { closeLimitReachedModal } = getActions();
  const lang = useLang();

  const [isClosing, startClosing, stopClosing] = useFlag();

  useEffect(() => {
    if (!limit && isClosing) stopClosing();
  }, [isClosing, limit, stopClosing]);

  const title = lang('LimitReached');
  const valueFormatter = limit && LIMIT_VALUE_FORMATTER[limit];
  const description = getLimiterDescription({
    lang,
    limitType: limit,
    isPremium,
    defaultValue,
    premiumValue,
    valueFormatter,
  });
  const icon = limit && LIMIT_ICON[limit];

  return (
    <Modal
      onClose={startClosing}
      onCloseAnimationEnd={closeLimitReachedModal}
      isOpen={Boolean(limit) && !isClosing}
      title={title}
      className={styles.root}
    >
      <div className={styles.limitBadge}>
        <i className={buildClassName(styles.limitIcon, icon, 'icon')} />
        <div className={styles.limitValue}>
          {valueFormatter?.(
            lang, isPremium ? premiumValue : defaultValue,
          ) || (isPremium ? premiumValue : defaultValue)}
        </div>
      </div>

      <div>
        {renderText(description || '', ['simple_markdown', 'br'])}
      </div>

      <div className={styles.dialogButtons}>
        <Button
          className="confirm-dialog-button"
          isText
          onClick={startClosing}
          color="primary"
        >
          {lang('OK')}
        </Button>
      </div>
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { limit }): Complete<StateProps> => {
    const { limits } = global.appConfig;
    const isPremium = selectIsCurrentUserPremium(global);

    return {
      defaultValue: limit ? limits?.[limit][0] : undefined,
      premiumValue: limit ? limits?.[limit][1] : undefined,
      isPremium,
    };
  },
)(PremiumLimitReachedModal));
