import {
  memo, useEffect, useMemo, useState,
} from '../../../lib/teact/teact';
import { withGlobal } from '../../../global';

import { filterPeersByQuery } from '../../../global/helpers/peers';
import { unique } from '../../../util/iteratees';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import PeerPicker from '../../common/pickers/PeerPicker';
import PickerModal from '../../common/pickers/PickerModal';

type OwnProps = {
  isOpen?: boolean;
  chatIds: string[];
  onSave: (chatIds: string[]) => void;
  onClose: NoneToVoidFunction;
};

type StateProps = {
  currentUserId?: string;
  activeIds?: string[];
  archivedIds?: string[];
};

/** Picks the people and groups that notify while a notification profile is on */
const NotificationProfileChatsModal = ({
  isOpen,
  chatIds,
  currentUserId,
  activeIds,
  archivedIds,
  onSave,
  onClose,
}: OwnProps & StateProps) => {
  const lang = useLang();
  const [selectedIds, setSelectedIds] = useState<string[]>(chatIds);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(chatIds);
    setQuery('');
  }, [isOpen, chatIds]);

  // Allowed chats stay listed, whatever the search
  const itemIds = useMemo(() => {
    const listedIds = [...activeIds ?? [], ...archivedIds ?? []].filter((id) => id !== currentUserId);
    const foundIds = query ? filterPeersByQuery({ ids: listedIds, query }) : listedIds;
    return unique([...chatIds, ...foundIds]);
  }, [activeIds, archivedIds, chatIds, currentUserId, query]);

  const handleConfirm = useLastCallback(() => {
    onSave(selectedIds);
  });

  return (
    <PickerModal
      isOpen={isOpen}
      title={lang('NotificationProfileAllowed')}
      hasCloseButton
      withFixedHeight
      confirmButtonText={lang('Save')}
      onConfirm={handleConfirm}
      onClose={onClose}
    >
      <PeerPicker
        withIslands
        itemIds={itemIds}
        selectedIds={selectedIds}
        filterValue={query}
        filterPlaceholder={lang('Search')}
        isSearchable
        withDefaultPadding
        allowMultiple
        itemInputType="checkbox"
        onFilterChange={setQuery}
        onSelectedIdsChange={setSelectedIds}
      />
    </PickerModal>
  );
};

export default memo(withGlobal<OwnProps>((global): Complete<StateProps> => ({
  currentUserId: global.currentUserId,
  activeIds: global.chats.listIds.active,
  archivedIds: global.chats.listIds.archived,
}))(NotificationProfileChatsModal));
