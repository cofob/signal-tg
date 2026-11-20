import { memo } from '../../../lib/teact/teact';

import useHistoryBack from '../../../hooks/useHistoryBack';

import SignalProxyForm from '../../common/SignalProxyForm';
import Island from '../../gili/layout/Island';

type OwnProps = {
  isActive?: boolean;
  onReset: NoneToVoidFunction;
};

const SettingsSignalProxy = ({
  isActive,
  onReset,
}: OwnProps) => {
  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  return (
    <div className="settings-content custom-scroll">
      <Island>
        <SignalProxyForm onSave={onReset} />
      </Island>
    </div>
  );
};

export default memo(SettingsSignalProxy);
