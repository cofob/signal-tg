import { memo, useState } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { RegularLangKey } from '../../types/language';

import { selectSharedSettings } from '../../global/selectors/sharedState';
import { checkSignalProxyUrl, parseSignalProxyUrl } from '../../util/signalProxy';

import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import InputText from '../ui/InputText';

import styles from './SignalProxyForm.module.scss';

type OwnProps = {
  // Edits the sealed sender proxy instead of the proxy server
  isSealedSender?: boolean;
  // Runs after saving a URL or restoring the default
  onSave?: NoneToVoidFunction;
};

type StateProps = {
  // The saved URL of the proxy that the form edits
  savedUrl?: string;
};

type Status = {
  value: string;
  errorKey?: RegularLangKey;
  successKey?: RegularLangKey;
};

/** The proxy server field with check, save and reset; settings and the link screen share it */
const SignalProxyForm = ({
  isSealedSender,
  savedUrl,
  onSave,
}: OwnProps & StateProps) => {
  const { setSignalProxyUrl, setSignalSealedSenderProxyUrl } = getActions();

  const lang = useLang();

  const [value, setValue] = useState(savedUrl ?? '');
  // An error or check result describes the value it was made for, so editing hides it
  const [status, setStatus] = useState<Status>();
  const [isChecking, markIsChecking, unmarkIsChecking] = useFlag();

  const trimmedValue = value.trim();
  const isChanged = trimmedValue !== (savedUrl ?? '');
  const shownStatus = status?.value === value ? status : undefined;

  const handleChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  });

  const handleSubmit = useLastCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isChanged) return;

    if (!trimmedValue) {
      handleUseDefault();
      return;
    }

    const { url, errorKey } = parseSignalProxyUrl(value);
    if (!url) {
      setStatus({ value, errorKey });
      return;
    }

    setValue(url);
    saveUrl(url);
    onSave?.();
  });

  const saveUrl = useLastCallback((url: string | undefined) => {
    if (isSealedSender) setSignalSealedSenderProxyUrl({ url });
    else setSignalProxyUrl({ url });
  });

  const handleCheck = useLastCallback(async () => {
    if (isChecking) return;

    const checkedValue = value;
    const { url, errorKey } = parseSignalProxyUrl(checkedValue);
    if (!url) {
      setStatus({ value: checkedValue, errorKey });
      return;
    }

    markIsChecking();
    const isReachable = await checkSignalProxyUrl(url);
    unmarkIsChecking();
    setStatus(isReachable
      ? { value: checkedValue, successKey: 'SignalProxyReachable' }
      : { value: checkedValue, errorKey: 'SignalProxyUnreachable' });
  });

  const handleUseDefault = useLastCallback(() => {
    setValue('');
    saveUrl(undefined);
    onSave?.();
  });

  return (
    <form className={styles.root} onSubmit={handleSubmit}>
      <p className={styles.description} dir="auto">
        {lang(isSealedSender ? 'SignalSealedProxyAbout' : 'SignalProxyAbout')}
      </p>
      <InputText
        value={value}
        label={lang('SignalProxyUrl')}
        inputMode="url"
        error={shownStatus?.errorKey && lang(shownStatus.errorKey)}
        success={shownStatus?.successKey && lang(shownStatus.successKey)}
        onChange={handleChange}
      />
      <Button type="submit" disabled={!isChanged}>
        {lang('Save')}
      </Button>
      <Button isText isLoading={isChecking} disabled={!trimmedValue} onClick={handleCheck}>
        {lang('SignalProxyCheck')}
      </Button>
      {savedUrl && (
        <Button isText onClick={handleUseDefault}>
          {lang(isSealedSender ? 'SignalSealedProxyUseMain' : 'SignalProxyUseDefault')}
        </Button>
      )}
    </form>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { isSealedSender }): Complete<StateProps> => {
    const { signalProxyUrl, signalSealedSenderProxyUrl } = selectSharedSettings(global);

    return {
      savedUrl: isSealedSender ? signalSealedSenderProxyUrl : signalProxyUrl,
    };
  },
)(SignalProxyForm));
