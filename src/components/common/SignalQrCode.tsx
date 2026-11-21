import { memo, useLayoutEffect, useRef } from '../../lib/teact/teact';

import { STRICTERDOM_ENABLED } from '../../config';
import { disableStrict, enableStrict } from '../../lib/fasterdom/stricterdom';
import buildClassName from '../../util/buildClassName';
import { createStyledQrCode } from '../../util/qrCode/buildStyledQrCode';

import useAsync from '../../hooks/useAsync';

import styles from './SignalQrCode.module.scss';

type OwnProps = {
  // A link, or with `isBinary`, one character per byte
  data: string;
  size: number;
  isBinary?: boolean;
  className?: string;
};

// The library draws the code after `append` returns
const QR_CODE_MUTATION_DURATION = 50;

/** A plain QR code without an image in the middle, so Signal's scanner reads it */
const SignalQrCode = ({
  data, size, isBinary, className,
}: OwnProps) => {
  const containerRef = useRef<HTMLDivElement>();
  const { result: qrCode } = useAsync(() => createStyledQrCode({ size, image: '' }), [size]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!qrCode || !container) return;

    if (STRICTERDOM_ENABLED) disableStrict();
    qrCode.update({ data, qrOptions: { mode: isBinary ? 'Byte' : undefined } });
    if (!container.firstChild) qrCode.append(container);
    if (STRICTERDOM_ENABLED) window.setTimeout(enableStrict, QR_CODE_MUTATION_DURATION);
  }, [data, isBinary, qrCode]);

  return (
    <div
      ref={containerRef}
      className={buildClassName(styles.root, className)}
      style={`width: ${size}px; height: ${size}px`}
    />
  );
};

export default memo(SignalQrCode);
