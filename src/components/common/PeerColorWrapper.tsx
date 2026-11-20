import type { ElementRef } from '../../lib/teact/teact';
import { memo } from '../../lib/teact/teact';

import type { ApiPeer, ApiTypePeerColor } from '../../api/types';

import buildClassName from '../../util/buildClassName';

import usePeerColor from '../../hooks/usePeerColor';

import EmojiIconBackground from './embedded/EmojiIconBackground';

import styles from './PeerColorWrapper.module.scss';

interface OwnProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: ElementRef<HTMLDivElement>;
  peer?: ApiPeer;
  peerColor?: ApiTypePeerColor;
  isReply?: boolean;
  noBar?: boolean;
  noUserColors?: boolean;
  shouldReset?: boolean;
  className?: string;
  emojiIconClassName?: string;
  children: React.ReactNode;
}

function PeerColorWrapper({
  ref,
  peer,
  peerColor,
  isReply,
  noBar,
  noUserColors,
  shouldReset,
  className,
  emojiIconClassName,
  children,
  ...otherProps
}: OwnProps) {
  const color = peerColor || peer?.color;

  const {
    style,
    className: peerColorClassName,
    backgroundEmojiId,
  } = usePeerColor({ peer, color, noUserColors, shouldReset });

  return (
    <div
      ref={ref}
      className={buildClassName(
        styles.root,
        peerColorClassName,
        !noBar && styles.withBar,
        className,
      )}
      style={style}
      {...otherProps}
    >
      {backgroundEmojiId && (
        <EmojiIconBackground
          className={emojiIconClassName}
          emojiDocumentId={backgroundEmojiId}
        />
      )}
      {children}
    </div>
  );
}

export default memo(PeerColorWrapper);
