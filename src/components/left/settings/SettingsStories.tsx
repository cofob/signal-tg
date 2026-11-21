import {
  memo, useEffect, useMemo, useState,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiStoryDistributionList, ApiStorySettings } from '../../../api/types';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandDescription, IslandTitle } from '../../gili/layout/Island';
import Checkbox from '../../ui/Checkbox';
import ListItem from '../../ui/ListItem';
import RadioGroup from '../../ui/RadioGroup';
import StoryListEditorModal from './StoryListEditorModal';

type OwnProps = {
  isActive?: boolean;
  onReset: NoneToVoidFunction;
};

type StateProps = {
  settings?: ApiStorySettings;
  distributionLists?: ApiStoryDistributionList[];
};

type MyStoryAudience = 'all' | 'except' | 'only';

// The list being edited: a custom list by id, a new one, or the people of My Story for an audience
type Editing = { listId: string } | { isNewList: true } | { audience: Exclude<MyStoryAudience, 'all'> };

const NO_MEMBERS: string[] = [];

/**
 * Stories settings of Signal (Android `StorySettingsFragment`): stories on or off, view receipts, who sees My Story
 * and whether they may reply, and custom distribution lists. Every change goes to the storage service.
 */
const SettingsStories = ({
  isActive,
  settings,
  distributionLists,
  onReset,
}: OwnProps & StateProps) => {
  const {
    loadStorySettings, loadStoryDistributionLists, updateStorySettings, saveStoryDistributionList,
    deleteStoryDistributionList,
  } = getActions();

  const lang = useLang();
  const [editing, setEditing] = useState<Editing | undefined>();

  useHistoryBack({ isActive, onBack: onReset });

  useEffect(() => {
    if (!isActive) return;
    loadStorySettings();
    loadStoryDistributionLists();
  }, [isActive]);

  const myStory = distributionLists?.find(({ isMyStory }) => isMyStory);
  const customLists = distributionLists?.filter(({ isMyStory }) => !isMyStory);
  const audience: MyStoryAudience | undefined = myStory
    && (!myStory.isBlockList ? 'only' : myStory.memberIds.length ? 'except' : 'all');
  const editingList = editing && 'listId' in editing
    ? customLists?.find(({ id }) => id === editing.listId)
    : undefined;

  const handleStoriesChange = useLastCallback((isEnabled: boolean) => {
    updateStorySettings({ areStoriesDisabled: !isEnabled });
  });

  const handleViewReceiptsChange = useLastCallback((isEnabled: boolean) => {
    updateStorySettings({ areViewReceiptsEnabled: isEnabled });
  });

  const handleAudienceChange = useLastCallback((value: string) => {
    if (!myStory) return;
    if (value === 'all') {
      saveStoryDistributionList({ list: { ...myStory, isBlockList: true, memberIds: [] } });
      return;
    }
    setEditing({ audience: value as Exclude<MyStoryAudience, 'all'> });
  });

  const handleRepliesChange = useLastCallback((isAllowed: boolean) => {
    if (myStory) saveStoryDistributionList({ list: { ...myStory, areRepliesAllowed: isAllowed } });
  });

  const handleNewList = useLastCallback(() => {
    setEditing({ isNewList: true });
  });

  const handleCloseEditor = useLastCallback(() => {
    setEditing(undefined);
  });

  const handleSaveList = useLastCallback((memberIds: string[], name?: string) => {
    if (editing && 'audience' in editing && myStory) {
      saveStoryDistributionList({ list: { ...myStory, isBlockList: editing.audience === 'except', memberIds } });
    } else if (editingList) {
      saveStoryDistributionList({ list: { ...editingList, name: name!, memberIds } });
    } else {
      saveStoryDistributionList({
        list: {
          name: name!, memberIds, areRepliesAllowed: true, isBlockList: false,
        },
      });
    }
    setEditing(undefined);
  });

  const editingAudience = editing && 'audience' in editing ? editing.audience : undefined;
  // Switching between excluding and allowing people starts with nobody picked
  const editorMemberIds = editingAudience
    ? (myStory && myStory.isBlockList === (editingAudience === 'except') ? myStory.memberIds : NO_MEMBERS)
    : editingList?.memberIds ?? NO_MEMBERS;
  const areStoriesDisabled = settings?.areStoriesDisabled;

  const audienceOptions = useMemo(() => {
    const count = myStory?.memberIds.length ?? 0;
    const countLabel = lang('StoryListMembers', { count }, { pluralValue: count });
    return [
      { value: 'all', label: lang('StoryMyStoryAllConnections') },
      {
        value: 'except',
        label: lang('StoriesSettingAllExcept'),
        subLabel: audience === 'except' ? countLabel : undefined,
      },
      {
        value: 'only',
        label: lang('StoriesSettingOnlyShare'),
        subLabel: audience === 'only' ? countLabel : undefined,
      },
    ];
  }, [audience, lang, myStory]);

  return (
    <div className="settings-content custom-scroll">
      <Island>
        <Checkbox
          label={lang('StoriesSettingEnable')}
          subLabel={lang('StoriesSettingEnableInfo')}
          checked={!areStoriesDisabled}
          disabled={!settings}
          onCheck={handleStoriesChange}
        />
        <Checkbox
          label={lang('StoriesSettingViewReceipts')}
          subLabel={lang('StoriesSettingViewReceiptsInfo')}
          checked={Boolean(settings?.areViewReceiptsEnabled)}
          disabled={!settings || areStoriesDisabled}
          onCheck={handleViewReceiptsChange}
        />
      </Island>

      {!areStoriesDisabled && myStory && (
        <>
          <IslandTitle>{lang('StoryRibbonMyStory')}</IslandTitle>
          <Island>
            <RadioGroup
              name="my-story-audience"
              options={audienceOptions}
              selected={audience}
              onChange={handleAudienceChange}
            />
            {audience && audience !== 'all' && (
              <ListItem icon="user" narrow onClick={() => setEditing({ audience })}>
                {lang('StoriesSettingChoosePeople')}
              </ListItem>
            )}
            <Checkbox
              label={lang('StoriesSettingAllowReplies')}
              checked={myStory.areRepliesAllowed}
              onCheck={handleRepliesChange}
            />
          </Island>
          <IslandDescription>{lang('StoriesSettingMyStoryInfo')}</IslandDescription>

          <IslandTitle>{lang('StoriesSettingCustomLists')}</IslandTitle>
          <Island>
            {customLists?.map((list) => (
              <ListItem
                key={list.id}
                icon="group"
                narrow
                secondaryIcon="delete"
                onClick={() => setEditing({ listId: list.id })}
                onSecondaryIconClick={() => deleteStoryDistributionList({ id: list.id })}
              >
                <div className="multiline-item">
                  <span className="title">{list.name}</span>
                  <span className="subtitle">
                    {lang('StoryListMembers', { count: list.memberIds.length }, { pluralValue: list.memberIds.length })}
                  </span>
                </div>
              </ListItem>
            ))}
            <ListItem icon="add" narrow onClick={handleNewList}>
              {lang('StoriesSettingNewList')}
            </ListItem>
          </Island>
        </>
      )}

      <StoryListEditorModal
        isOpen={Boolean(editing)}
        title={lang(editingAudience ? 'StoryRibbonMyStory' : 'StoriesSettingCustomList')}
        name={editingAudience ? undefined : editingList?.name ?? ''}
        memberIds={editorMemberIds}
        onSave={handleSaveList}
        onClose={handleCloseEditor}
      />
    </div>
  );
};

export default memo(withGlobal<OwnProps>((global): Complete<StateProps> => ({
  settings: global.stories.settings,
  distributionLists: global.stories.distributionLists,
}))(SettingsStories));
