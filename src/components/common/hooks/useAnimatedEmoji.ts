import { useRef } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import buildStyle from '../../../util/buildStyle';
import safePlay from '../../../util/safePlay';
import { REM } from '../helpers/mediaDimensions';

import useLastCallback from '../../../hooks/useLastCallback';
import useMedia from '../../../hooks/useMedia';

const SIZE = 7 * REM;

export default function useAnimatedEmoji(
  chatId?: string,
  messageId?: number,
  soundId?: string,
  isOwn?: boolean,
  emoji?: string,
  preferredSize?: number,
) {
  const { interactWithAnimatedEmoji } = getActions();

  const ref = useRef<HTMLDivElement>();

  const audioRef = useRef<HTMLAudioElement | undefined>();

  const soundMediaData = useMedia(soundId ? `document${soundId}` : undefined, !soundId);

  const size = preferredSize || SIZE;
  const style = buildStyle(`width: ${size}px`, `height: ${size}px`, emoji && !IS_TAURI && 'cursor: pointer');

  const play = useLastCallback(() => {
    const audio = audioRef.current;
    if (soundMediaData) {
      if (audio) {
        audio.pause();
        audio.remove();
      }
      audioRef.current = new Audio();
      audioRef.current.src = soundMediaData;
      safePlay(audioRef.current);
      audioRef.current.addEventListener('ended', () => {
        audioRef.current = undefined;
      }, { once: true });
    }
  });

  const handleClick = useLastCallback(() => {
    play();

    const container = ref.current;

    if (!emoji || !container || !messageId || !chatId) {
      return;
    }

    const { x, y } = container.getBoundingClientRect();

    interactWithAnimatedEmoji({
      emoji,
      x,
      y,
      startSize: size,
      isReversed: !isOwn,
    });
  });

  return {
    ref,
    size,
    style,
    handleClick,
  };
}
