import { memo, useCallback, useState } from '../../../lib/teact/teact';

import { STICKER_SIZE_PASSCODE } from '../../../config';
import { LOCAL_TGS_PREVIEW_URLS, LOCAL_TGS_URLS } from '../../common/helpers/animatedAssets';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';

import AnimatedIconWithPreview from '../../common/AnimatedIconWithPreview';
import PasswordForm from '../../common/PasswordForm';
import Island from '../../gili/layout/Island';

type OwnProps = {
  error?: string;
  isLoading?: boolean;
  shouldDisablePasswordManager?: boolean;
  expectedPassword?: string;
  placeholder?: string;
  hint?: string;
  description?: string;
  submitLabel?: string;
  isActive?: boolean;
  onSubmit: (password: string) => void;
  onClearError?: NoneToVoidFunction;
  onReset: () => void;
};

const SettingsPasswordForm = ({
  isActive,
  error,
  isLoading,
  shouldDisablePasswordManager,
  expectedPassword,
  placeholder,
  hint,
  description,
  submitLabel,
  onSubmit,
  onClearError,
  onReset,
}: OwnProps) => {
  const [validationError, setValidationError] = useState<string>('');
  const [shouldShowPassword, setShouldShowPassword] = useState(false);

  const lang = useLang();

  const handleSubmit = useCallback((newPassword) => {
    if (expectedPassword && newPassword !== expectedPassword) {
      setValidationError(lang('SettingsPasswordEqual'));
    } else {
      onSubmit(newPassword);
    }
  }, [onSubmit, expectedPassword, lang]);

  const handleClearError = useCallback(() => {
    if (onClearError) {
      onClearError();
    }
    setValidationError('');
  }, [onClearError]);

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  return (
    <div className="settings-content password-form custom-scroll">
      <div className="settings-content-header no-border">
        <AnimatedIconWithPreview
          tgsUrl={LOCAL_TGS_URLS.Lock}
          previewUrl={LOCAL_TGS_PREVIEW_URLS.Lock}
          size={STICKER_SIZE_PASSCODE}
          className="settings-content-icon"
        />
      </div>

      <Island>
        <div className="settings-input">
          <PasswordForm
            shouldShowSubmit
            error={validationError || error}
            hint={hint}
            description={description}
            placeholder={placeholder || lang('CurrentPasswordPlaceholder')}
            shouldDisablePasswordManager={shouldDisablePasswordManager}
            submitLabel={submitLabel}
            onClearError={handleClearError}
            isLoading={isLoading}
            isPasswordVisible={shouldShowPassword}
            shouldResetValue={isActive}
            onChangePasswordVisibility={setShouldShowPassword}
            onSubmit={handleSubmit}
          />
        </div>
      </Island>
    </div>
  );
};

export default memo(SettingsPasswordForm);
