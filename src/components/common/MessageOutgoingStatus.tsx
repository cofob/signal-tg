import { memo } from '../../lib/teact/teact';

import type { ApiMessageOutgoingStatus } from '../../api/types';

import buildClassName from '../../util/buildClassName';

import Transition from '../ui/Transition';
import Icon from './icons/Icon';

import './MessageOutgoingStatus.scss';

type OwnProps = {
  status: ApiMessageOutgoingStatus;
};

enum Keys {
  failed, pending, succeeded, delivered, read,
}

const MessageOutgoingStatus = ({ status }: OwnProps) => {
  const className = buildClassName(
    'MessageOutgoingStatus', status === 'delivered' && 'MessageOutgoingStatus--delivered',
  );

  return (
    <div className={className}>
      <Transition name="reveal" activeKey={Keys[status]}>
        {status === 'failed' ? (
          <div className="MessageOutgoingStatus--failed">
            <Icon name="message-failed" />
          </div>
        ) : <Icon name={getIconName(status)} />}
      </Transition>
    </div>
  );
};

function getIconName(status: Exclude<ApiMessageOutgoingStatus, 'failed'>) {
  if (status === 'succeeded') return 'check';
  // Delivered messages show the read checks in the meta color
  if (status === 'delivered') return 'message-read';
  return `message-${status}` as const;
}

export default memo(MessageOutgoingStatus);
