import { memo, useCallback, useState } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { GlobalState } from '../../global/types';

import { pick } from '../../util/iteratees';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import InputText from '../ui/InputText';

type StateProps = {
  auth: GlobalState['auth'];
};

// Signal Android `EditProfileNameFragment.NAME_MAX_GLYPHS`, counted here in UTF-16 units
const NAME_MAX_LENGTH = 26;

const AuthRegister = ({
  auth,
}: StateProps) => {
  const { signUp, clearAuthErrorKey } = getActions();
  const { isLoading, errorKey } = auth;

  const lang = useLang();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isDiscoverable, setIsDiscoverable] = useState(true);

  const handleFirstNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (errorKey) {
      clearAuthErrorKey();
    }

    setFirstName(event.target.value);
  }, [errorKey]);

  const handleLastNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setLastName(event.target.value);
  }, []);

  const handleDiscoverableChange = useLastCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setIsDiscoverable(event.target.checked);
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading) return;

    signUp({ firstName, lastName, isDiscoverableByPhoneNumber: isDiscoverable });
  }

  return (
    <div id="auth-registration-form" className="custom-scroll">
      <div className="auth-form">
        <form action="" method="post" onSubmit={handleSubmit}>
          <h2>{lang('YourName')}</h2>
          <p className="note">{lang('SignalProfileDescription')}</p>
          <InputText
            id="registration-first-name"
            label={lang('LoginRegisterFirstNamePlaceholder')}
            onChange={handleFirstNameChange}
            value={firstName}
            maxLength={NAME_MAX_LENGTH}
            error={errorKey && lang.withRegular(errorKey)}
            autoComplete="given-name"
          />
          <InputText
            id="registration-last-name"
            label={lang('LoginRegisterLastNamePlaceholder')}
            onChange={handleLastNameChange}
            value={lastName}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="family-name"
          />
          <Checkbox
            id="registration-discoverable"
            label={lang('SignalRegisterDiscoverable')}
            checked={isDiscoverable}
            onChange={handleDiscoverableChange}
          />
          {Boolean(firstName.trim()) && (
            <Button type="submit" ripple isLoading={isLoading}>{lang('Next')}</Button>
          )}
        </form>
      </div>
    </div>
  );
};

export default memo(withGlobal(
  (global): Complete<StateProps> => (
    pick(global, ['auth'])
  ),
)(AuthRegister));
