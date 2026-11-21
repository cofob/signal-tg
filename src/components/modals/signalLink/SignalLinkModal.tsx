import { memo } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { TabState } from '../../../global/types';
import { SettingsScreens } from '../../../types';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import ConfirmDialog from '../../ui/ConfirmDialog';

export type OwnProps = {
  modal: NonNullable<TabState['signalLinkModal']>;
  isOpen: boolean;
};

/**
 * Explains a Signal link to something that this app does not do. A proxy link offers the proxy server settings
 * instead, and changes nothing by itself.
 */
const SignalLinkModal = ({ modal, isOpen }: OwnProps) => {
  const { closeSignalLinkModal, openSettingsScreen } = getActions();
  const lang = useLang();

  const { type, host } = modal;
  const isProxy = type === 'proxy';

  const handleConfirm = useLastCallback(() => {
    closeSignalLinkModal();
    if (isProxy) openSettingsScreen({ screen: SettingsScreens.SignalProxy });
  });

  const handleClose = useLastCallback(() => {
    closeSignalLinkModal();
  });

  function renderContent() {
    switch (type) {
      case 'proxy':
        return { title: lang('SignalProxyLinkTitle'), text: lang('SignalProxyLinkText', { host }) };
      case 'callLink':
        return { title: lang('SignalCallLinkTitle'), text: lang('SignalCallLinkText') };
      case 'linkDevice':
        return { title: lang('SignalDeviceLinkTitle'), text: lang('SignalDeviceLinkText') };
      case 'reRegister':
        return { title: lang('SignalReRegisterTitle'), text: lang('SignalReRegisterText') };
    }
  }

  const { title, text } = renderContent();

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={title}
      text={text}
      confirmLabel={isProxy ? lang('SignalProxySettings') : lang('OK')}
      isOnlyConfirm={!isProxy}
      confirmHandler={handleConfirm}
      onClose={handleClose}
    />
  );
};

export default memo(SignalLinkModal);
