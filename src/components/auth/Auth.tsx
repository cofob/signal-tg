import '../../global/actions/initial';

import { memo } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { GlobalState } from '../../global/types';

import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { IS_MAC_OS } from '../../util/browser/windowEnvironment';

import useCurrentOrPrev from '../../hooks/useCurrentOrPrev';
import useHistoryBack from '../../hooks/useHistoryBack';

import Transition from '../ui/Transition';
import AuthCaptcha from './AuthCaptcha';
import AuthCode from './AuthCode.async';
import AuthHistorySync from './AuthHistorySync';
import AuthPassword from './AuthPassword.async';
import AuthPhoneNumber from './AuthPhoneNumber';
import AuthQrCode from './AuthQrCode';
import AuthRegister from './AuthRegister.async';

import './Auth.scss';

type StateProps = {
  authState: GlobalState['auth']['state'];
  isSyncingHistory: boolean;
};

const Auth = ({
  authState,
  isSyncingHistory,
}: StateProps) => {
  const { goToAuthQrCode } = getActions();

  // Registration starts from the link QR code, so going back from phone number entry returns to it
  useHistoryBack({
    isActive: authState === 'authorizationStateWaitPhoneNumber',
    onBack: goToAuthQrCode,
  });

  // For animation purposes
  const renderingAuthState = useCurrentOrPrev(
    authState !== 'authorizationStateReady' ? authState : undefined,
    true,
  );

  function getScreen() {
    switch (renderingAuthState) {
      case 'authorizationStateWaitCode':
        return <AuthCode />;
      case 'authorizationStateWaitPassword':
        return <AuthPassword />;
      case 'authorizationStateWaitRegistration':
        return <AuthRegister />;
      case 'authorizationStateWaitPhoneNumber':
        return <AuthPhoneNumber />;
      case 'authorizationStateWaitCaptcha':
        return <AuthCaptcha />;
      case 'authorizationStateWaitQrCode':
        return isSyncingHistory ? <AuthHistorySync /> : <AuthQrCode />;
      default:
        return <AuthQrCode />;
    }
  }

  function getActiveKey() {
    switch (renderingAuthState) {
      case 'authorizationStateWaitCode':
        return 0;
      case 'authorizationStateWaitPassword':
        return 1;
      case 'authorizationStateWaitRegistration':
        return 2;
      case 'authorizationStateWaitPhoneNumber':
        return 3;
      case 'authorizationStateWaitCaptcha':
        return 6;
      case 'authorizationStateWaitQrCode':
        return isSyncingHistory ? 5 : 4;
      default:
        return 4;
    }
  }

  return (
    <Transition
      activeKey={getActiveKey()}
      name="fade"
      className="Auth"
      data-tauri-drag-region={IS_TAURI && IS_MAC_OS ? true : undefined}
    >
      {getScreen()}
    </Transition>
  );
};

export default memo(withGlobal(
  (global): Complete<StateProps> => {
    return {
      authState: global.auth.state,
      isSyncingHistory: Boolean(global.auth.historySync),
    };
  },
)(Auth));
