import { memo } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { TabState } from '../../../global/types';
import type { SettingsConfirmation } from '../../../types';

import useLastCallback from '../../../hooks/useLastCallback';

import SignOutDialog from './SignOutDialog';

export type OwnProps = {
  modal: NonNullable<TabState['settingsConfirmation']>;
  isOpen: boolean;
};

const DIALOGS = {
  logOut: SignOutDialog,
} satisfies Record<SettingsConfirmation, unknown>;

const SettingsConfirmationModal = ({ modal, isOpen }: OwnProps) => {
  const { closeSettingsConfirmation } = getActions();

  const handleClose = useLastCallback(() => {
    closeSettingsConfirmation();
  });

  const Dialog = DIALOGS[modal];

  return <Dialog isOpen={isOpen} onClose={handleClose} />;
};

export default memo(SettingsConfirmationModal);
