import { memo, useEffect } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { ApiLimitTypeWithModal } from '../../api/types';
import type { IconName } from '../../types/icons';
import type { LangKey } from '../../types/language';
import type { LangFn } from '../../util/localization';

import buildClassName from '../../util/buildClassName';
import { LIMITS } from '../../limits';
import renderText from '../common/helpers/renderText';

import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';

import Button from '../ui/Button';
import Modal from '../ui/Modal';

import styles from './LimitReachedModal.module.scss';

const LIMIT_DESCRIPTION = {
  dialogFiltersChats: 'LimitReachedChatInFoldersPremium',
  uploadMaxFileparts: 'LimitReachedFileSizePremium',
  dialogFilters: 'LimitReachedFoldersPremium',
  dialogFolderPinned: 'LimitReachedPinDialogsPremium',
} as const satisfies Record<ApiLimitTypeWithModal, LangKey>;

const LIMIT_ICON: Record<ApiLimitTypeWithModal, IconName> = {
  dialogFiltersChats: 'chat-badge',
  uploadMaxFileparts: 'file-badge',
  dialogFilters: 'folder-filled',
  dialogFolderPinned: 'pin-filled',
};

// `MAX_UPLOAD_SIZE` falls slightly short of 2 GB, so the limit shows rounded
const UPLOAD_LIMIT_GB = 2;

const LIMIT_VALUE_FORMATTER: Partial<Record<ApiLimitTypeWithModal, (lang: LangFn) => string>> = {
  uploadMaxFileparts: (lang) => lang('MediaSizeGB', { size: UPLOAD_LIMIT_GB }, { pluralValue: UPLOAD_LIMIT_GB }),
};

export type OwnProps = {
  limit?: ApiLimitTypeWithModal;
};

const LimitReachedModal = ({ limit }: OwnProps) => {
  const { closeLimitReachedModal } = getActions();
  const lang = useLang();

  const [isClosing, startClosing, stopClosing] = useFlag();

  useEffect(() => {
    if (!limit && isClosing) stopClosing();
  }, [isClosing, limit, stopClosing]);

  const formattedValue = limit && (LIMIT_VALUE_FORMATTER[limit]?.(lang) || LIMITS[limit].toString());
  const description = limit && lang(LIMIT_DESCRIPTION[limit], { limit: formattedValue });
  const icon = limit && LIMIT_ICON[limit];

  return (
    <Modal
      onClose={startClosing}
      onCloseAnimationEnd={closeLimitReachedModal}
      isOpen={Boolean(limit) && !isClosing}
      title={lang('LimitReached')}
      className={styles.root}
    >
      <div className={styles.limitBadge}>
        <i className={buildClassName(styles.limitIcon, icon, 'icon')} />
        <div className={styles.limitValue}>{formattedValue}</div>
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

export default memo(LimitReachedModal);
