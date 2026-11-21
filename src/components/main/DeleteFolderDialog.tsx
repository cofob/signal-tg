import { memo, useCallback } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { ApiChatFolder } from '../../api/types';

import useLang from '../../hooks/useLang';
import usePreviousDeprecated from '../../hooks/usePreviousDeprecated';

import ConfirmDialog from '../ui/ConfirmDialog';

export type OwnProps = {
  folder?: ApiChatFolder;
};

const DeleteFolderDialog = ({
  folder,
}: OwnProps) => {
  const { closeDeleteChatFolderModal, deleteChatFolder } = getActions();
  const lang = useLang();

  const isOpen = Boolean(folder);

  const renderingFolder = usePreviousDeprecated(folder) || folder;

  const handleDeleteFolderMessage = useCallback(() => {
    closeDeleteChatFolderModal();
    deleteChatFolder({ id: renderingFolder!.id });
  }, [renderingFolder]);

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={closeDeleteChatFolderModal}
      text={lang('FilterDeleteAlert')}
      confirmLabel={lang('Delete')}
      confirmHandler={handleDeleteFolderMessage}
      confirmIsDestructive
    />
  );
};

export default memo(DeleteFolderDialog);
