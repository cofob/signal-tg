import { memo, useEffect, useState } from '../../../lib/teact/teact';
import { getActions, getPromiseActions, withGlobal } from '../../../global';

import type { ApiSignalDevice, ApiSignalDevices } from '../../../api/types';

import { SIGNAL_PRIMARY_DEVICE_ID } from '../../../lib/signal/config';
import { formatDateTime } from '../../../util/localization/dateFormat';

import useFlag from '../../../hooks/useFlag';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandDescription } from '../../gili/layout/Island';
import ConfirmDialog from '../../ui/ConfirmDialog';
import ListItem, { type MenuItemContextAction } from '../../ui/ListItem';
import Loading from '../../ui/Loading';

type OwnProps = {
  isActive?: boolean;
  onReset: NoneToVoidFunction;
};

type StateProps = {
  signalDevices?: ApiSignalDevices;
};

const SettingsSignalDevices = ({
  isActive,
  signalDevices,
  onReset,
}: OwnProps & StateProps) => {
  const { loadSignalDevices, openLinkDeviceModal } = getActions();
  const lang = useLang();

  const [deviceToUnlink, setDeviceToUnlink] = useState<ApiSignalDevice | undefined>();
  const [isUpdating, startUpdating, stopUpdating] = useFlag();

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  useEffect(() => {
    if (isActive) loadSignalDevices();
  }, [isActive]);

  const handleLinkClick = useLastCallback(() => {
    openLinkDeviceModal({});
  });

  const handleUnlink = useLastCallback(async () => {
    const device = deviceToUnlink!;
    setDeviceToUnlink(undefined);
    startUpdating();
    await getPromiseActions().unlinkSignalDevice({ deviceId: device.id });
    stopUpdating();
  });

  const handleUnlinkClose = useLastCallback(() => {
    setDeviceToUnlink(undefined);
  });

  function getDeviceName({ name }: ApiSignalDevice) {
    return name || lang('SignalDevicesUnnamed');
  }

  function getContextActions(device: ApiSignalDevice): MenuItemContextAction[] | undefined {
    if (!signalDevices?.isPrimary || device.id === signalDevices.currentDeviceId) return undefined;
    return [{
      title: lang('SignalDevicesUnlink'),
      icon: 'delete',
      destructive: true,
      handler: () => setDeviceToUnlink(device),
    }];
  }

  function renderDevice(device: ApiSignalDevice) {
    const isCurrent = device.id === signalDevices!.currentDeviceId;
    const lastSeen = lang('SignalDevicesLastActive', { date: formatDateTime(lang, new Date(device.lastSeen)) });
    return (
      <ListItem
        key={device.id}
        icon={device.id === SIGNAL_PRIMARY_DEVICE_ID ? 'phone' : 'devices-filled'}
        multiline
        narrow
        disabled={isUpdating}
        contextActions={getContextActions(device)}
      >
        <span className="title">{getDeviceName(device)}</span>
        <span className="subtitle">{isCurrent ? lang('SignalDevicesThisDevice') : lastSeen}</span>
      </ListItem>
    );
  }

  return (
    <div className="settings-content custom-scroll">
      {!signalDevices && <Loading />}
      {signalDevices && (
        <>
          {signalDevices.isPrimary && (
            <Island>
              <ListItem icon="add" narrow disabled={isUpdating} onClick={handleLinkClick}>
                {lang('SignalDevicesLink')}
              </ListItem>
            </Island>
          )}
          <Island>
            {signalDevices.devices.map(renderDevice)}
          </Island>
          <IslandDescription dir="auto">
            {lang(signalDevices.isPrimary ? 'SignalDevicesPrimaryAbout' : 'SignalDevicesLinkedAbout')}
          </IslandDescription>
        </>
      )}
      <ConfirmDialog
        isOpen={Boolean(deviceToUnlink)}
        title={lang('SignalDevicesUnlinkTitle', { name: deviceToUnlink ? getDeviceName(deviceToUnlink) : '' })}
        text={lang('SignalDevicesUnlinkText')}
        confirmLabel={lang('SignalDevicesUnlink')}
        confirmIsDestructive
        confirmHandler={handleUnlink}
        onClose={handleUnlinkClose}
      />
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    return {
      signalDevices: global.settings.byKey.signalDevices,
    };
  },
)(SettingsSignalDevices));
