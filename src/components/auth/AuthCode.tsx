import {
  memo, useCallback, useEffect, useRef, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiAuthCodeTransport } from '../../api/types';
import type { GlobalState } from '../../global/types';

import { IS_TOUCH_ENV } from '../../util/browser/windowEnvironment';
import { formatMediaDuration } from '../../util/dates/duration';
import { pick } from '../../util/iteratees';

import useInterval from '../../hooks/schedulers/useInterval';
import useHistoryBack from '../../hooks/useHistoryBack';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Icon from '../common/icons/Icon';
import TrackingMonkey from '../common/TrackingMonkey';
import Button from '../ui/Button';
import InputText from '../ui/InputText';
import Loading from '../ui/Loading';

type StateProps = {
  auth: GlobalState['auth'];
};

// Signal verification codes have six digits
const CODE_LENGTH = 6;
const COUNTDOWN_INTERVAL_MS = 1000;
const MS_IN_SECOND = 1000;

const AuthCode = ({
  auth,
}: StateProps) => {
  const {
    setAuthCode,
    requestAuthCode,
    returnToAuthPhoneNumber,
    clearAuthErrorKey,
  } = getActions();

  const {
    phoneNumber, codeInfo, isLoading, errorKey,
  } = auth;

  const lang = useLang();
  const inputRef = useRef<HTMLInputElement>();

  const [code, setCode] = useState<string>('');
  const [isTracking, setIsTracking] = useState(false);
  const [trackingDirection, setTrackingDirection] = useState(1);

  useEffect(() => {
    if (!IS_TOUCH_ENV) {
      inputRef.current!.focus();
    }
  }, []);

  useHistoryBack({
    isActive: true,
    onBack: returnToAuthPhoneNumber,
  });

  const onCodeChange = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    if (errorKey) {
      clearAuthErrorKey();
    }

    const { currentTarget: target } = e;
    target.value = target.value.replace(/[^\d]+/, '').substr(0, CODE_LENGTH);

    if (target.value === code) {
      return;
    }

    setCode(target.value);

    if (!isTracking) {
      setIsTracking(true);
    } else if (!target.value.length) {
      setIsTracking(false);
    }

    if (code && code.length > target.value.length) {
      setTrackingDirection(-1);
    } else {
      setTrackingDirection(1);
    }

    if (target.value.length === CODE_LENGTH) {
      setAuthCode({ code: target.value });
    }
  }, [errorKey, code, isTracking]);

  function handleReturnToAuthPhoneNumber() {
    returnToAuthPhoneNumber();
  }

  const handleRequestSms = useLastCallback(() => {
    requestAuthCode({ transport: 'sms' });
  });

  const handleRequestCall = useLastCallback(() => {
    requestAuthCode({ transport: 'voice' });
  });

  const [now, setNow] = useState(Date.now);
  const hasCountdown = [codeInfo?.nextSmsAt, codeInfo?.nextCallAt].some((at) => at !== undefined && at > now);
  useInterval(() => setNow(Date.now()), hasCountdown ? COUNTDOWN_INTERVAL_MS : undefined);

  function renderResendButton(transport: ApiAuthCodeTransport, nextAt: number | undefined) {
    if (nextAt === undefined) return undefined;

    const secondsLeft = Math.ceil((nextAt - now) / MS_IN_SECOND);
    const isSms = transport === 'sms';
    const time = formatMediaDuration(secondsLeft);
    return (
      <Button
        className="auth-button"
        isText
        disabled={secondsLeft > 0 || isLoading}
        onClick={isSms ? handleRequestSms : handleRequestCall}
      >
        {secondsLeft > 0
          ? lang(isSms ? 'SignalCodeResendSmsIn' : 'SignalCodeCallIn', { time })
          : lang(isSms ? 'SignalCodeResendSms' : 'SignalCodeCall')}
      </Button>
    );
  }

  return (
    <div id="auth-code-form" className="custom-scroll">
      <div className="auth-form">
        <TrackingMonkey
          code={code}
          codeLength={CODE_LENGTH}
          isTracking={isTracking}
          trackingDirection={trackingDirection}
        />
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
        <p className="note">
          {lang(codeInfo?.transport === 'voice' ? 'SignalCodeSentVoice' : 'SignalCodeSentSms')}
        </p>
        <InputText
          ref={inputRef}
          id="sign-in-code"
          label={lang('Code')}
          onInput={onCodeChange}
          value={code}
          error={errorKey && lang.withRegular(errorKey)}
          autoComplete="off"
          inputMode="numeric"
        />
        {isLoading && <Loading />}
        {renderResendButton('sms', codeInfo?.nextSmsAt)}
        {renderResendButton('voice', codeInfo?.nextCallAt)}
      </div>
    </div>
  );
};

export default memo(withGlobal(
  (global): Complete<StateProps> => (
    pick(global, ['auth'])
  ),
)(AuthCode));
