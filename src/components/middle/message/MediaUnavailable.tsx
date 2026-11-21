import { memo } from '../../../lib/teact/teact';

import useLang from '../../../hooks/useLang';

import Icon from '../../common/icons/Icon';

import styles from './media.module.scss';

/** Covers photos, videos and stickers that the CDN no longer has */
const MediaUnavailable = () => {
  const lang = useLang();

  return (
    <div className={styles.unavailable} title={lang('MediaUnavailable')}>
      <Icon name="link-broken" className={styles.unavailableIcon} />
      {lang('MediaUnavailable')}
    </div>
  );
};

export default memo(MediaUnavailable);
