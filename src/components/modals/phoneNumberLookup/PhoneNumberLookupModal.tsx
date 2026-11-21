import { memo } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { TabState } from '../../../global/types';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import ConfirmDialog from '../../ui/ConfirmDialog';

export type OwnProps = {
  modal: NonNullable<TabState['phoneNumberLookupModal']>;
  isOpen: boolean;
};

/** Asks before a phone number from a link goes to the contact discovery service */
const PhoneNumberLookupModal = ({ modal, isOpen }: OwnProps) => {
  const { closePhoneNumberLookupModal, openChatByPhoneNumber } = getActions();
  const lang = useLang();

  const handleConfirm = useLastCallback(() => {
    closePhoneNumberLookupModal();
    openChatByPhoneNumber({ phoneNumber: modal.phoneNumber });
  });

  const handleClose = useLastCallback(() => {
    closePhoneNumberLookupModal();
  });

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={lang('SignalPhoneLookupTitle')}
      text={lang('SignalPhoneLookupText', { phone: `+${modal.phoneNumber}` })}
      confirmLabel={lang('SignalPhoneLookupConfirm')}
      confirmHandler={handleConfirm}
      onClose={handleClose}
    />
  );
};

export default memo(PhoneNumberLookupModal);
