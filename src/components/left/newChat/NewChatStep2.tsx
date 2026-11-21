import {
  memo,
  useCallback, useEffect, useState,
} from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type { ApiAvatarUpload } from '../../../api/types';
import type { RegularLangKey } from '../../../types/language';
import { ChatCreationProgress } from '../../../types';

import { getUserFirstOrLastName } from '../../../global/helpers';
import { selectTabState } from '../../../global/selectors';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';

import PrivateChatInfo from '../../common/PrivateChatInfo';
import AvatarEditable from '../../ui/AvatarEditable';
import Button from '../../ui/Button';
import FloatingActionButton from '../../ui/FloatingActionButton';
import InputText from '../../ui/InputText';
import ListItem from '../../ui/ListItem';

export type OwnProps = {
  isActive: boolean;
  memberIds: string[];
  onReset: (forceReturnToChatList?: boolean) => void;
};

type StateProps = {
  creationProgress?: ChatCreationProgress;
  creationError?: RegularLangKey;
  maxGroupSize?: number;
};

const MAX_MEMBERS_FOR_GENERATE_CHAT_NAME = 4;

const CHAT_TITLE_EMPTY_ERROR = 'NewChatTitleEmptyError';
const CHAT_TOO_MANY_USERS_ERROR = 'NewChatTooManyUsers';

const NewChatStep2 = ({
  isActive,
  memberIds,
  maxGroupSize,
  creationProgress,
  creationError,
  onReset,
}: OwnProps & StateProps) => {
  const { createGroupChat } = getActions();

  const lang = useLang();

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  const [title, setTitle] = useState('');
  const [photo, setPhoto] = useState<ApiAvatarUpload | undefined>();
  const [error, setError] = useState<RegularLangKey | undefined>();

  const isLoading = creationProgress === ChatCreationProgress.InProgress;

  useEffect(() => {
    if (!memberIds.length || memberIds.length > MAX_MEMBERS_FOR_GENERATE_CHAT_NAME) {
      setTitle('');
      return;
    }
    const global = getGlobal();
    const usersById = global.users.byId;
    const memberFirstNames = [global.currentUserId!, ...memberIds]
      .map((userId) => getUserFirstOrLastName(lang, usersById[userId]))
      .filter(Boolean);
    const generatedChatName = lang.conjunction(memberFirstNames);
    setTitle(generatedChatName);
  }, [memberIds, lang]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.currentTarget;
    const newValue = value.replace(/^\s+/, '');

    setTitle(newValue);

    if (newValue !== value) {
      e.currentTarget.value = newValue;
    }
  }, []);

  const handleCreateGroup = useCallback(() => {
    if (!title.length) {
      setError(CHAT_TITLE_EMPTY_ERROR);
      return;
    }

    if (maxGroupSize && memberIds.length >= maxGroupSize) {
      setError(CHAT_TOO_MANY_USERS_ERROR);
      return;
    }

    createGroupChat({
      title,
      photo,
      memberIds,
    });
  }, [title, memberIds, maxGroupSize, createGroupChat, photo]);

  useEffect(() => {
    if (creationProgress === ChatCreationProgress.Complete) {
      onReset(true);
    }
  }, [creationProgress, onReset]);

  const renderedError = (creationError && lang(creationError)) || (
    error !== CHAT_TITLE_EMPTY_ERROR ? error && lang(error) : undefined
  );

  return (
    <div className="NewChat">
      <div className="left-header">
        <Button
          round
          size="smaller"
          color="translucent"
          onClick={() => onReset()}
          ariaLabel={lang('NewChatReturnBackAria')}
          iconName="arrow-left"
        />
        <h3>{lang('NewGroup')}</h3>
      </div>
      <div className="NewChat-inner step-2">
        <AvatarEditable
          onChange={setPhoto}
          title={lang('AddPhoto')}
          isLoading={isLoading}
        />
        <InputText
          value={title}
          onChange={handleTitleChange}
          label={lang('GroupName')}
          error={error === CHAT_TITLE_EMPTY_ERROR ? lang(error) : undefined}
        />

        {renderedError && (
          <p className="error">{renderedError}</p>
        )}

        {memberIds.length > 0 && (
          <>
            <h3 className="chat-members-heading">
              {lang('GroupInfoParticipantCount', {
                count: lang.number(memberIds.length),
              }, { pluralValue: memberIds.length })}
            </h3>

            <div className="chat-members-list custom-scroll">
              {memberIds.map((id) => (
                <ListItem inactive className="chat-item-clickable">
                  <PrivateChatInfo userId={id} />
                </ListItem>
              ))}
            </div>
          </>
        )}
      </div>

      <FloatingActionButton
        isShown={title.length !== 0}
        onClick={handleCreateGroup}
        disabled={isLoading}
        ariaLabel={lang('AriaCreateGroup')}
        iconName="arrow-right"
        isLoading={isLoading}
      />
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const {
      progress: creationProgress,
      error: creationError,
    } = selectTabState(global).chatCreation || {};

    return {
      creationProgress,
      creationError,
      maxGroupSize: global.config?.maxGroupSize,
    };
  },
)(NewChatStep2));
