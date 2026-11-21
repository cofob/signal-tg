import { IS_WEBAUTHN_SIGNAL_API_SUPPORTED } from './windowEnvironment';

export function signalUnknownPasskey(credentialId: string) {
  if (!IS_WEBAUTHN_SIGNAL_API_SUPPORTED) return;

  void PublicKeyCredential.signalUnknownCredential({
    rpId: window.location.hostname,
    credentialId,
  }).catch(() => undefined);
}
