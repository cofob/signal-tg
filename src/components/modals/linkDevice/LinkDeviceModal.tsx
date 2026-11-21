import {
  memo, useEffect, useRef, useState,
} from '../../../lib/teact/teact';
import { getActions, getPromiseActions } from '../../../global';

import type { TabState } from '../../../global/types';

import useFlag from '../../../hooks/useFlag';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';
import Modal from '../../ui/Modal';

import styles from './LinkDeviceModal.module.scss';

export type OwnProps = {
  modal: NonNullable<TabState['linkDeviceModal']>;
  isOpen: boolean;
};

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
};

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

const LINK_PREFIX = 'sgnl://linkdevice';
const SCAN_INTERVAL_MS = 400;

/**
 * Links another device to this account from a primary device: the QR code of the new device is scanned with the
 * camera where the browser can read QR codes, or its `sgnl://linkdevice` link is pasted.
 */
const LinkDeviceModal = ({ modal, isOpen }: OwnProps) => {
  const { closeLinkDeviceModal } = getActions();
  const lang = useLang();

  const [link, setLink] = useState(modal.url ?? '');
  const [isLinking, startLinking, stopLinking] = useFlag();
  const [isScanning, startScanning, stopScanning] = useFlag();
  const videoRef = useRef<HTMLVideoElement>();

  const Detector = (window as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  const trimmedLink = link.trim();

  useEffect(() => {
    if (isOpen) setLink(modal.url ?? '');
  }, [isOpen, modal.url]);

  useEffect(() => {
    if (!isScanning || !Detector) return undefined;

    const detector = new Detector({ formats: ['qr_code'] });
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let isCancelled = false;

    async function scan() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = videoRef.current!;
        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        timer = setInterval(async () => {
          const [code] = await detector.detect(video).catch(() => []);
          if (code?.rawValue.toLowerCase().startsWith(LINK_PREFIX)) {
            setLink(code.rawValue);
            stopScanning();
          }
        }, SCAN_INTERVAL_MS);
      } catch {
        stopScanning();
      }
    }
    scan();

    return () => {
      isCancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [isScanning, Detector]);

  const handleClose = useLastCallback(() => {
    stopScanning();
    closeLinkDeviceModal();
  });

  const handleLinkChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLink(e.target.value);
  });

  const handleSubmit = useLastCallback(async () => {
    if (!trimmedLink || isLinking) return;
    startLinking();
    await getPromiseActions().linkSignalDevice({ url: trimmedLink });
    stopLinking();
  });

  const handleKeyDown = useLastCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // A link that came from outside needs a click: Enter must not link a device the user has not looked at
    if (link === modal.url) return;
    handleSubmit();
  });

  return (
    <Modal
      isOpen={isOpen}
      title={lang('SignalDeviceLinkPrompt')}
      isSlim
      hasCloseButton
      onClose={handleClose}
    >
      <p className={styles.description}>{lang('SignalDeviceLinkPromptText')}</p>
      <p className={styles.description}>{lang('SignalDeviceLinkWarning')}</p>
      {isScanning && <video ref={videoRef} className={styles.video} muted playsInline />}
      <InputText
        id="link-device-url"
        label={lang('SignalDeviceLinkField')}
        className={styles.input}
        value={link}
        disabled={isLinking}
        teactExperimentControlled
        onChange={handleLinkChange}
        onKeyDown={handleKeyDown}
      />
      <div className={styles.buttons}>
        {Detector && (
          <Button
            isText
            disabled={isLinking}
            onClick={isScanning ? stopScanning : startScanning}
          >
            {lang(isScanning ? 'SignalDeviceLinkStopScan' : 'SignalDeviceLinkScan')}
          </Button>
        )}
        <Button disabled={!trimmedLink} isLoading={isLinking} onClick={handleSubmit}>
          {lang('SignalDeviceLinkConfirm')}
        </Button>
      </div>
    </Modal>
  );
};

export default memo(LinkDeviceModal);
