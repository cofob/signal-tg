import { memo, useState } from '../../../lib/teact/teact';
import { getActions, getPromiseActions } from '../../../global';

import { SettingsScreens } from '../../../types';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import SettingsPasswordForm from './SettingsPasswordForm';

type OwnProps = {
  isActive?: boolean;
  // The PIN of the previous step, which this step confirms
  newPin?: string;
  onNewPin: (pin: string) => void;
  onReset: NoneToVoidFunction;
};

// Signal Android `SvrConstants.MINIMUM_PIN_LENGTH`
const MIN_PIN_LENGTH = 4;

/** A new PIN, then its confirmation, which stores it in SVR2 */
const SettingsSignalPinForm = ({
  isActive,
  newPin,
  onNewPin,
  onReset,
}: OwnProps) => {
  const { openSettingsScreen } = getActions();
  const lang = useLang();

  const [error, setError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  const handleClearError = useLastCallback(() => setError(undefined));

  const handleSubmit = useLastCallback(async (pin: string) => {
    if (newPin === undefined) {
      if (pin.trim().length < MIN_PIN_LENGTH) {
        setError(lang('SignalPinErrorShort'));
        return;
      }
      onNewPin(pin);
      openSettingsScreen({ screen: SettingsScreens.SignalPinConfirm });
      return;
    }

    if (pin !== newPin) {
      setError(lang('SignalPinErrorMismatch'));
      return;
    }
    setIsLoading(true);
    await getPromiseActions().setSignalPin({ pin });
    setIsLoading(false);
    openSettingsScreen({ screen: SettingsScreens.SignalPin });
  });

  return (
    <SettingsPasswordForm
      isActive={isActive}
      error={error}
      isLoading={isLoading}
      placeholder={lang(newPin === undefined ? 'SignalPinNew' : 'SignalPinConfirm')}
      description={newPin === undefined ? lang('SignalPinNewDescription') : undefined}
      submitLabel={lang(newPin === undefined ? 'Continue' : 'Save')}
      onSubmit={handleSubmit}
      onClearError={handleClearError}
      onReset={onReset}
    />
  );
};

export default memo(SettingsSignalPinForm);
