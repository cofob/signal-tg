import { memo, useState } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { GlobalState } from '../../global/types';

import { pick } from '../../util/iteratees';

import useHistoryBack from '../../hooks/useHistoryBack';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Icon from '../common/icons/Icon';
import Button from '../ui/Button';
import InputText from '../ui/InputText';

type StateProps = {
  auth: GlobalState['auth'];
};

// The user solves the captcha in a tab of its own: the app makes no requests to third parties
const CAPTCHA_URL = 'https://signalcaptchas.org/registration/generate.html';

const AuthCaptcha = ({
  auth,
}: StateProps) => {
  const { setAuthCaptcha, returnToAuthPhoneNumber, clearAuthErrorKey } = getActions();
  const lang = useLang();

  const { phoneNumber, isLoading, errorKey } = auth;
  const [captchaLink, setCaptchaLink] = useState('');

  useHistoryBack({
    isActive: true,
    onBack: returnToAuthPhoneNumber,
  });

  const handleOpenCaptcha = useLastCallback(() => {
    window.open(CAPTCHA_URL, '_blank', 'noopener,noreferrer');
  });

  const handleChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (errorKey) clearAuthErrorKey();
    setCaptchaLink(e.target.value);
  });

  const handleSubmit = useLastCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading || !captchaLink.trim()) return;
    setAuthCaptcha({ captchaLink });
  });

  const handleReturnToAuthPhoneNumber = useLastCallback(() => {
    returnToAuthPhoneNumber();
  });

  return (
    <div id="auth-captcha-form" className="custom-scroll">
      <div className="auth-form">
        <h1>
          {phoneNumber}
          <div
            className="auth-number-edit div-button"
            onClick={handleReturnToAuthPhoneNumber}
            role="button"
            tabIndex={0}
            title={lang('WrongNumber')}
            aria-label={lang('WrongNumber')}
          >
            <Icon name="edit" />
          </div>
        </h1>
        <p className="note">{lang('SignalCaptchaTitle')}</p>
        <ol className="auth-steps">
          <li><span>{lang('SignalCaptchaHelp1')}</span></li>
          <li><span>{lang('SignalCaptchaHelp2', undefined, { withNodes: true, withMarkdown: true })}</span></li>
          <li><span>{lang('SignalCaptchaHelp3')}</span></li>
        </ol>
        <Button className="auth-button" isText onClick={handleOpenCaptcha}>
          {lang('SignalCaptchaOpen')}
        </Button>
        <form action="" onSubmit={handleSubmit}>
          <InputText
            id="sign-in-captcha"
            label={lang('SignalCaptchaLink')}
            value={captchaLink}
            error={errorKey && lang.withRegular(errorKey)}
            autoComplete="off"
            onChange={handleChange}
          />
          {Boolean(captchaLink.trim()) && (
            <Button className="auth-button" type="submit" ripple isLoading={isLoading}>
              {lang('LoginNext')}
            </Button>
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
)(AuthCaptcha));
