import type { ChangeEvent } from 'react';
import {
  memo, useEffect, useMemo, useState,
} from '../../../lib/teact/teact';
import { withGlobal } from '../../../global';

import { filterPeersByQuery } from '../../../global/helpers/peers';
import { isUserId } from '../../../util/entities/ids';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import PeerPicker from '../../common/pickers/PeerPicker';
import PickerModal from '../../common/pickers/PickerModal';
import InputText from '../../ui/InputText';

type OwnProps = {
  isOpen?: boolean;
  title: string;
  // Custom lists have a name; My Story does not
  name?: string;
  memberIds: string[];
  onSave: (memberIds: string[], name?: string) => void;
  onClose: NoneToVoidFunction;
};

type StateProps = {
  currentUserId?: string;
  orderedChatIds?: string[];
};

/** Picks the people of a story distribution list, and the name of a custom list */
const StoryListEditorModal = ({
  isOpen,
  title,
  name,
  memberIds,
  currentUserId,
  orderedChatIds,
  onSave,
  onClose,
}: OwnProps & StateProps) => {
  const lang = useLang();
  const [selectedIds, setSelectedIds] = useState<string[]>(memberIds);
  const [newName, setNewName] = useState(name ?? '');
  const [query, setQuery] = useState('');
  const hasName = name !== undefined;

  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(memberIds);
    setNewName(name ?? '');
    setQuery('');
  }, [isOpen, memberIds, name]);

  const itemIds = useMemo(() => {
    const userIds = (orderedChatIds ?? []).filter((id) => isUserId(id) && id !== currentUserId);
    return query ? filterPeersByQuery({ ids: userIds, query }) : [...new Set([...memberIds, ...userIds])];
  }, [currentUserId, memberIds, orderedChatIds, query]);

  const handleNameChange = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    setNewName(e.currentTarget.value);
  });

  const handleConfirm = useLastCallback(() => {
    onSave(selectedIds, hasName ? newName.trim() : undefined);
  });

  return (
    <PickerModal
      isOpen={isOpen}
      title={title}
      hasCloseButton
      withFixedHeight
      confirmButtonText={lang('Save')}
      isConfirmDisabled={hasName && !newName.trim()}
      onConfirm={handleConfirm}
      onClose={onClose}
    >
      {hasName && (
        <InputText value={newName} label={lang('StoryListName')} onChange={handleNameChange} />
      )}
      <PeerPicker
        withIslands
        itemIds={itemIds}
        selectedIds={selectedIds}
        filterValue={query}
        filterPlaceholder={lang('Search')}
        isSearchable
        withStatus
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
  orderedChatIds: global.chats.listIds.active,
}))(StoryListEditorModal));
