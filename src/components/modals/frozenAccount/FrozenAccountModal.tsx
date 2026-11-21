import { memo, useMemo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { TabState } from '../../../global/types';

import { formatDateTime } from '../../../util/localization/dateFormat';
import { LOCAL_TGS_URLS } from '../../common/helpers/animatedAssets';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import AnimatedIconWithPreview from '../../common/AnimatedIconWithPreview';
import Button from '../../ui/Button';
import Link from '../../ui/Link';
import TableAboutModal, { type TableAboutData } from '../common/TableAboutModal';

import styles from './FrozenAccountModal.module.scss';

export type OwnProps = {
  modal: TabState['isFrozenAccountModalOpen'];
};

type StateProps = {
  freezeAppealUrl?: string;
  freezeUntilDate?: number;
};

const ICON_SIZE = 130;

const FrozenAccountModal = ({
  modal,
  freezeUntilDate,
  freezeAppealUrl,
}: OwnProps & StateProps) => {
  const {
    closeFrozenAccountModal,
    openUrl,
  } = getActions();
  const lang = useLang();

  const isOpen = Boolean(modal);

  const handleClose = useLastCallback(() => {
    closeFrozenAccountModal();
  });

  const handleAppeal = useLastCallback(() => {
    closeFrozenAccountModal();
    if (freezeAppealUrl) {
      openUrl({ url: freezeAppealUrl });
    }
  });

  const header = useMemo(() => {
    return (
      <div className={styles.header}>
        <AnimatedIconWithPreview
          size={ICON_SIZE}
          tgsUrl={LOCAL_TGS_URLS.HandStop}
          noLoop
        />
        <div className={styles.title}>
          {lang('FrozenAccountModalTitle')}
        </div>
      </div>
    );
  }, [lang]);

  const footer = useMemo(() => {
    if (!isOpen) return undefined;
    return (
      <div className={styles.footer}>
        <Button
          className={styles.buttonAppeal}
          onClick={handleAppeal}
        >
          {lang('ButtonAppeal')}
        </Button>
        <Button
          isText
          onClick={handleClose}
        >
          {lang('ButtonUnderstood')}
        </Button>
      </div>
    );
  }, [lang, isOpen]);

  const listItemData = useMemo(() => {
    if (!freezeUntilDate) return undefined;

    const date = new Date(freezeUntilDate * 1000);

    const botLink = (
      <Link onClick={handleAppeal} isPrimary>
        {lang('ButtonAppeal')}
      </Link>
    );

    return [
      ['hand-stop', lang('FrozenAccountViolationTitle'), lang('FrozenAccountViolationSubtitle')],
      ['lock', lang('FrozenAccountReadOnlyTitle'), lang('FrozenAccountReadOnlySubtitle')],
      ['frozen-time', lang('FrozenAccountAppealTitle'),
        lang('FrozenAccountAppealSubtitle', {
          botLink,
          date: formatDateTime(lang, date, { date: 'short' }),
        }, {
          withNodes: true,
        })],
    ] satisfies TableAboutData;
  }, [lang, freezeUntilDate]);

  if (!listItemData) return undefined;

  return (
    <TableAboutModal
      isOpen={isOpen}
      header={header}
      listItemData={listItemData}
      footer={footer}
      onClose={handleClose}
    />
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const freezeUntilDate = global.appConfig.freezeUntilDate;
    const freezeAppealUrl = global.appConfig.freezeAppealUrl;

    return {
      freezeUntilDate,
      freezeAppealUrl,
    };
  },
)(FrozenAccountModal));
