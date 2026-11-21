import {JSX} from 'solid-js';
import classNames from '@helpers/string/classNames';
import styles from '@components/star3D/star3D.module.scss';

export type StarKind = 'premium' | 'stars';

/**
 * TeleSignal: the place of the 3D star of Telegram Premium and Telegram Stars, which are Telegram-only. Upstream draws
 * the star with `telegram-3d-star` (GPL-2.0-only, which GPL-3.0 code cannot include); the box keeps its `size` in the
 * flow until the screens that show it are removed
 */
export default function Star3D(props: {
  kind: StarKind,
  /** The star's visible size in px */
  size: number,
  active?: boolean,
  class?: string
}): JSX.Element {
  return (
    <div
      class={classNames(styles.star, props.class)}
      style={{'--star-size': props.size + 'px'}}
      aria-hidden="true"
    />
  );
}
