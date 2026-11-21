import {
  memo, useCallback, useMemo, useState,
} from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type {
  ApiChatMember,
} from '../../api/types';
import { NewChatMembersProgress } from '../../types';

import { filterPeersByQuery } from '../../global/helpers/peers';
import { selectChatFullInfo, selectTabState } from '../../global/selectors';
import { unique } from '../../util/iteratees';
import sortChatIds from '../common/helpers/sortChatIds';

import useHistoryBack from '../../hooks/useHistoryBack';
import useLang from '../../hooks/useLang';
import usePeerSearch, { userGlobalSearch } from '../../hooks/usePeerSearch';
import usePreviousDeprecated from '../../hooks/usePreviousDeprecated';

import PeerPicker from '../common/pickers/PeerPicker';
import FloatingActionButton from '../ui/FloatingActionButton';

import './AddChatMembers.scss';

export type OwnProps = {
  chatId: string;
  isActive: boolean;
  onNextStep: (memberIds: string[]) => void;
  onClose: NoneToVoidFunction;
};

type StateProps = {
  members?: ApiChatMember[];
  currentUserId?: string;
  localContactIds?: string[];
  isLoading: boolean;
};

const AddChatMembers = ({
  members,
  onNextStep,
  currentUserId,
  localContactIds,
  isLoading,
  onClose,
  isActive,
}: OwnProps & StateProps) => {
  const lang = useLang();
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const { result: foundIds, currentResultsQuery, isSearching } = usePeerSearch({
    query: searchQuery,
    queryFn: userGlobalSearch,
  });
  const relevantFoundIds = currentResultsQuery === searchQuery ? foundIds : undefined;
  const prevSelectedMemberIds = usePreviousDeprecated(selectedMemberIds);
  const noPickerScrollRestore = prevSelectedMemberIds === selectedMemberIds;

  useHistoryBack({
    isActive,
    onBack: onClose,
  });

  const memberIds = useMemo(() => {
    return members ? members.map((member) => member.userId) : [];
  }, [members]);

  const displayedIds = useMemo(() => {
    const filteredIds = filterPeersByQuery({
      ids: unique([
        ...(localContactIds || []),
        ...(relevantFoundIds || []),
      ]),
      query: searchQuery,
      type: 'user',
    });

    return sortChatIds(
      filteredIds.filter((userId) => {
        // The user can be added to the chat if the following conditions are met:
        // the user has not yet been added to the current chat
        // AND it is not the current user
        return (
          !memberIds.includes(userId)
          && userId !== currentUserId
        );
      }),
    );
  }, [localContactIds, relevantFoundIds, searchQuery, currentUserId, memberIds]);

  const handleNextStep = useCallback(() => {
    if (selectedMemberIds.length) {
      onNextStep(selectedMemberIds);
    }
  }, [selectedMemberIds, onNextStep]);

  return (
    <div className="AddChatMembers">
      <div className="AddChatMembers-inner">
        <PeerPicker
          itemIds={displayedIds}
          selectedIds={selectedMemberIds}
          filterValue={searchQuery}
          filterPlaceholder={lang('ChannelAddUsers')}
          searchInputId="new-members-picker-search"
          isLoading={isSearching}
          onSelectedIdsChange={setSelectedMemberIds}
          onFilterChange={setSearchQuery}
          isSearchable
          withDefaultPadding
          withIslands
          noScrollRestore={noPickerScrollRestore}
          allowMultiple
          withStatus
          itemInputType="checkbox"
        />

        <FloatingActionButton
          isShown={Boolean(selectedMemberIds.length)}
          disabled={isLoading}
          ariaLabel={lang('ChannelAddUsers')}
          onClick={handleNextStep}
          iconName="arrow-right"
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const { userIds: localContactIds } = global.contactList || {};
    const { newChatMembersProgress } = selectTabState(global);
    const { currentUserId } = global;

    return {
      members: selectChatFullInfo(global, chatId)?.members,
      currentUserId,
      localContactIds,
      isLoading: newChatMembersProgress === NewChatMembersProgress.Loading,
    };
  },
)(AddChatMembers));
