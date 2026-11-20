import { memo, type TeactNode } from '../../../lib/teact/teact';

import type { ApiPaidMedia } from '../../../api/types';

import { formatStarsAsIcon } from '../../../util/localization/format';

import useLang from '../../../hooks/useLang';

import MediaBadge from './MediaBadge';

import styles from './PaidMediaOverlay.module.scss';

type OwnProps = {
  paidMedia: ApiPaidMedia;
  isOutgoing?: boolean;
  children?: TeactNode;
};

const PaidMediaOverlay = ({
  paidMedia,
  isOutgoing,
  children,
}: OwnProps) => {
  const lang = useLang();

  return (
    <div className={styles.root}>
      {children}
      {paidMedia.isBought && (
        <MediaBadge className="message-paid-media-status" position="right">
          {isOutgoing
            ? formatStarsAsIcon(lang, paidMedia.starsAmount)
            : lang('ChatPaidMediaPurchased')}
        </MediaBadge>
      )}
    </div>
  );
};

export default memo(PaidMediaOverlay);
