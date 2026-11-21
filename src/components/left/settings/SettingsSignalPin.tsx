import { memo, useEffect, useState } from '../../../lib/teact/teact';
import { getActions, getPromiseActions, withGlobal } from '../../../global';

import type { ApiSignalPinSettings } from '../../../api/types';
import { SettingsScreens } from '../../../types';

import useFlag from '../../../hooks/useFlag';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandDescription } from '../../gili/layout/Island';
import Checkbox from '../../ui/Checkbox';
import ConfirmDialog from '../../ui/ConfirmDialog';
import ListItem from '../../ui/ListItem';

type OwnProps = {
  isActive?: boolean;
  onReset: NoneToVoidFunction;
};

type StateProps = {
  signalPin?: ApiSignalPinSettings;
};

const SettingsSignalPin = ({
  isActive,
  signalPin,
  onReset,
}: OwnProps & StateProps) => {
  const { openSettingsScreen, loadSignalPinSettings } = getActions();
  const lang = useLang();

  const [isRemoveDialogOpen, openRemoveDialog, closeRemoveDialog] = useFlag();
  const [isUpdating, setIsUpdating] = useState(false);

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  useEffect(() => {
    if (isActive) loadSignalPinSettings();
  }, [isActive]);

  const handleOpenPinForm = useLastCallback(() => {
    openSettingsScreen({ screen: SettingsScreens.SignalPinNew });
  });

  const handleRegistrationLockChange = useLastCallback(async (isEnabled: boolean) => {
    setIsUpdating(true);
    await getPromiseActions().setSignalRegistrationLock({ isEnabled });
    setIsUpdating(false);
  });

  const handleRemovePin = useLastCallback(async () => {
    closeRemoveDialog();
    setIsUpdating(true);
    await getPromiseActions().removeSignalPin();
    setIsUpdating(false);
  });

  const hasPin = Boolean(signalPin?.hasPin);

  return (
    <div className="settings-content custom-scroll">
      <Island>
        <ListItem icon="lock" narrow disabled={isUpdating} onClick={handleOpenPinForm}>
          {lang(hasPin ? 'SignalPinChange' : 'SignalPinCreate')}
        </ListItem>
        {hasPin && (
          <ListItem icon="delete" narrow destructive disabled={isUpdating} onClick={openRemoveDialog}>
            {lang('SignalPinRemove')}
          </ListItem>
        )}
      </Island>
      <IslandDescription dir="auto">{lang('SignalPinAbout')}</IslandDescription>
      {hasPin && (
        <Island>
          <Checkbox
            label={lang('SignalPinRegistrationLock')}
            subLabel={lang('SignalPinRegistrationLockAbout')}
            checked={Boolean(signalPin?.isRegistrationLockEnabled)}
            disabled={isUpdating}
            onCheck={handleRegistrationLockChange}
          />
        </Island>
      )}
      <ConfirmDialog
        isOpen={isRemoveDialogOpen}
        title={lang('SignalPinRemove')}
        text={lang('SignalPinRemoveText')}
        confirmHandler={handleRemovePin}
        confirmIsDestructive
        confirmLabel={lang('Disable')}
        onClose={closeRemoveDialog}
      />
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => ({
    signalPin: global.settings.byKey.signalPin,
  }),
)(SettingsSignalPin));
