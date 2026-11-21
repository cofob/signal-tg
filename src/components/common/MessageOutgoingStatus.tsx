import { memo } from '../../lib/teact/teact';

import type { ApiMessageOutgoingStatus } from '../../api/types';

import buildClassName from '../../util/buildClassName';

import Transition from '../ui/Transition';
import Icon from './icons/Icon';

import './MessageOutgoingStatus.scss';

type OwnProps = {
  status: ApiMessageOutgoingStatus;
  // Failed and partially sent messages open their details
  onClick?: NoneToVoidFunction;
};

enum Keys {
  failed, pending, succeeded, delivered, read, partial,
}

const MessageOutgoingStatus = ({ status, onClick }: OwnProps) => {
  const className = buildClassName(
    'MessageOutgoingStatus',
    status === 'delivered' && 'MessageOutgoingStatus--delivered',
    onClick && 'MessageOutgoingStatus--clickable',
  );

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onClick!();
  }

  function renderIcon() {
    if (status === 'failed') {
      return (
        <div className="MessageOutgoingStatus--failed">
          <Icon name="message-failed" />
        </div>
      );
    }
    if (status === 'partial') {
      return (
        <div className="MessageOutgoingStatus--partial">
          <Icon name="warning-filled" />
        </div>
      );
    }
    return <Icon name={getIconName(status)} />;
  }

  return (
    <div className={className} onClick={onClick ? handleClick : undefined}>
      <Transition name="reveal" activeKey={Keys[status]}>
        {renderIcon()}
      </Transition>
    </div>
  );
};

function getIconName(status: Exclude<ApiMessageOutgoingStatus, 'failed' | 'partial'>) {
  if (status === 'succeeded') return 'check';
  // Delivered messages show the read checks in the meta color
  if (status === 'delivered') return 'message-read';
  return `message-${status}` as const;
}

export default memo(MessageOutgoingStatus);
