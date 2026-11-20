import { useRef } from '@teact';

import type { ApiPeer, ApiTypePeerColor } from '../api/types';
import type { CustomPeer } from '../types';

import { getPeerColorCount, getPeerColorKey } from '../global/helpers';
import useSyncEffect from './useSyncEffect';

type PeerColorAttributes = {
  className?: string;
  style?: string;
};

type PeerColorProperties = PeerColorAttributes & {
  backgroundEmojiId?: string;
};

export default function usePeerColor({
  peer,
  color,
  noUserColors,
  shouldReset,
}: {
  peer?: ApiPeer | CustomPeer;
  color?: ApiTypePeerColor;
  noUserColors?: boolean;
  shouldReset?: boolean;
}): PeerColorProperties {
  const propertiesRef = useRef<PeerColorAttributes>({});
  const realPeer = peer && !('isCustomPeer' in peer) ? peer : undefined;

  useSyncEffect(() => {
    if (!peer) {
      if (!shouldReset) {
        propertiesRef.current = {};
        return;
      }

      propertiesRef.current = {
        className: noUserColors ? getPeerColorCountClass(1) : getPeerColorClass(0),
      };
      return;
    }

    if ('isCustomPeer' in peer) {
      if (peer.peerColorId === undefined) {
        propertiesRef.current = {};
        return;
      }

      propertiesRef.current = { className: `peer-color-${peer.peerColorId}`, style: undefined };
      return;
    }

    const peerColor = color || peer.color;
    const colorCountClass = getPeerColorCountClass(getPeerColorCount(peer));
    const key = !peerColor?.color ? getPeerColorKey(peer) : peerColor.color;

    if (noUserColors) {
      propertiesRef.current = { className: colorCountClass };
      return;
    }

    const className = (noUserColors || key === undefined) ? colorCountClass : getPeerColorClass(key);
    propertiesRef.current = { className, style: undefined };
  }, [noUserColors, shouldReset, color, peer]);

  return {
    style: propertiesRef.current.style,
    className: propertiesRef.current.className,
    backgroundEmojiId: realPeer?.color?.backgroundEmojiId,
  };
}

export function getPeerColorClass(colorIndex: number) {
  return `peer-color-${colorIndex}`;
}

export function getPeerColorCountClass(colorCount: number) {
  return `peer-color-count-${colorCount}`;
}
