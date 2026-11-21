import {
  memo, useEffect, useMemo, useState,
} from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type { ApiAvatarUpload, ApiChat, ApiChatBannedRights, ApiChatFullInfo, ApiExportedInvite, ApiPhoto,
} from '../../../api/types';
import { ManagementProgress, ManagementScreens } from '../../../types';

import {
  getChatAvatarHash,
  getHasAdminRight,
} from '../../../global/helpers';
import {
  selectCanBanUsers, selectChat, selectChatFullInfo, selectIsChatRestricted, selectPeerAvatarPhoto, selectTabState,
} from '../../../global/selectors';
import { formatInteger } from '../../../util/text/textFormat';
import renderText from '../../common/helpers/renderText';

import useFlag from '../../../hooks/useFlag';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island from '../../gili/layout/Island';
import AvatarEditable from '../../ui/AvatarEditable';
import ConfirmDialog from '../../ui/ConfirmDialog';
import FloatingActionButton from '../../ui/FloatingActionButton';
import InputText from '../../ui/InputText';
import ListItem from '../../ui/ListItem';
import TextArea from '../../ui/TextArea';

import './Management.scss';

type OwnProps = {
  chatId: string;
  onScreenSelect: (screen: ManagementScreens) => void;
  onClose: NoneToVoidFunction;
  isActive: boolean;
};

type StateProps = {
  chat: ApiChat;
  chatFullInfo?: ApiChatFullInfo;
  currentAvatarPhoto?: ApiPhoto;
  progress?: ManagementProgress;
  canChangeInfo?: boolean;
  canBanUsers?: boolean;
  canInvite?: boolean;
  exportedInvites?: ApiExportedInvite[];
};

const GROUP_TITLE_EMPTY = 'GroupTitleEmptyError';
const GROUP_MAX_DESCRIPTION = 255;

const ALL_PERMISSIONS: Array<keyof ApiChatBannedRights> = [
  'sendMessages',
  'embedLinks',
  'sendPolls',
  'changeInfo',
  'inviteUsers',
  'pinMessages',
  'sendPhotos',
  'sendVideos',
  'sendRoundvideos',
  'sendVoices',
  'sendAudios',
  'sendDocs',
];
// Some checkboxes control multiple rights, and some rights are not controlled from Permissions screen,
// so we need to define the amount manually
const TOTAL_PERMISSIONS_COUNT = ALL_PERMISSIONS.length + 1;

const ManageGroup = ({
  chatId,
  chat,
  chatFullInfo,
  currentAvatarPhoto,
  progress,
  canChangeInfo,
  canBanUsers,
  canInvite,
  isActive,
  exportedInvites,
  onScreenSelect,
  onClose,
}: OwnProps & StateProps) => {
  const {
    updateChat,
    deleteChat,
    closeManagement,
    openChat,
    loadExportedChatInvites,
    loadChatJoinRequests,
  } = getActions();

  const [isDeleteDialogOpen, openDeleteDialog, closeDeleteDialog] = useFlag();
  const currentTitle = chat.title;
  const currentAbout = chatFullInfo?.about || '';

  const [isProfileFieldsTouched, setIsProfileFieldsTouched] = useState(false);
  const [title, setTitle] = useState(currentTitle);
  const [about, setAbout] = useState(currentAbout);
  const [photo, setPhoto] = useState<ApiAvatarUpload | undefined>();
  const [error, setError] = useState<string | undefined>();
  const imageHash = getChatAvatarHash(chat);
  const lang = useLang();

  useHistoryBack({
    isActive,
    onBack: onClose,
  });

  useEffect(() => {
    if (canInvite) {
      loadExportedChatInvites({ chatId });
      loadExportedChatInvites({ chatId, isRevoked: true });
      loadChatJoinRequests({ chatId });
    }
  }, [chatId, canInvite]);

  useEffect(() => {
    if (progress === ManagementProgress.Complete) {
      setIsProfileFieldsTouched(false);
      setError(undefined);
    }
  }, [progress]);

  const handleClickPermissions = useLastCallback(() => {
    onScreenSelect(ManagementScreens.GroupPermissions);
  });

  const handleClickAdministrators = useLastCallback(() => {
    onScreenSelect(ManagementScreens.ChatAdministrators);
  });

  const handleClickInvites = useLastCallback(() => {
    onScreenSelect(ManagementScreens.Invites);
  });

  const handleClickRequests = useLastCallback(() => {
    onScreenSelect(ManagementScreens.JoinRequests);
  });

  const handleSetPhoto = useLastCallback((newPhoto: ApiAvatarUpload) => {
    setPhoto(newPhoto);
    setIsProfileFieldsTouched(true);
  });

  const handleTitleChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    setIsProfileFieldsTouched(true);
  });

  const handleAboutChange = useLastCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAbout(e.target.value);
    setIsProfileFieldsTouched(true);
  });

  const handleUpdateGroup = useLastCallback(() => {
    const trimmedTitle = title.trim();
    const trimmedAbout = about.trim();

    if (!trimmedTitle.length) {
      setError(GROUP_TITLE_EMPTY);
      return;
    }

    updateChat({
      chatId,
      title: trimmedTitle,
      about: trimmedAbout,
      photo,
    });
  });

  const handleClickMembers = useLastCallback(() => {
    onScreenSelect(ManagementScreens.GroupMembers);
  });

  const enabledPermissionsCount = useMemo(() => {
    if (!chat.defaultBannedRights) {
      return 0;
    }

    let totalCount = ALL_PERMISSIONS.filter((key) => !chat.defaultBannedRights![key]).length;

    const { sendStickers, sendGifs } = chat.defaultBannedRights;

    // These two rights are controlled with a single checkbox
    if (!sendStickers && !sendGifs) {
      totalCount += 1;
    }

    return totalCount;
  }, [chat.defaultBannedRights]);

  const adminsCount = useMemo(() => {
    return Object.keys(chatFullInfo?.adminMembersById || {}).length;
  }, [chatFullInfo?.adminMembersById]);

  const handleDeleteGroup = useLastCallback(() => {
    deleteChat({ chatId: chat.id });
    closeDeleteDialog();
    closeManagement();
    openChat({ id: undefined });
  });

  const isRestricted = selectIsChatRestricted(getGlobal(), chatId);
  if (isRestricted || chat.isForbidden) {
    return undefined;
  }

  const isLoading = progress === ManagementProgress.InProgress;

  return (
    <div className="Management">
      <div className="panel-content custom-scroll">
        <AvatarEditable
          currentAvatarHash={imageHash}
          currentAvatarPhoto={currentAvatarPhoto}
          onChange={handleSetPhoto}
          disabled={!canChangeInfo}
          isLoading={isLoading}
        />
        <Island>
          <div className="settings-edit">
            <InputText
              id="group-title"
              label={lang('GroupName')}
              onChange={handleTitleChange}
              value={title}
              error={error === GROUP_TITLE_EMPTY ? lang(GROUP_TITLE_EMPTY) : undefined}
              disabled={!canChangeInfo}
            />
            <TextArea
              id="group-about"
              label={lang('DescriptionPlaceholder')}
              maxLength={GROUP_MAX_DESCRIPTION}
              maxLengthIndicator={(GROUP_MAX_DESCRIPTION - about.length).toString()}
              onChange={handleAboutChange}
              value={about}
              disabled={!canChangeInfo}
              noReplaceNewlines
            />
          </div>
          <ListItem
            icon="permissions"
            multiline
            onClick={handleClickPermissions}
            disabled={!canBanUsers}
          >
            <span className="title">{lang('ChannelPermissions')}</span>
            <span className="subtitle" dir="auto">
              {enabledPermissionsCount}
              /
              {TOTAL_PERMISSIONS_COUNT}
            </span>
          </ListItem>
          <ListItem
            icon="admin"
            multiline
            onClick={handleClickAdministrators}
          >
            <span className="title">{lang('ChannelAdministrators')}</span>
            <span className="subtitle">{formatInteger(adminsCount)}</span>
          </ListItem>
          {canInvite && (
            <ListItem
              icon="link"
              onClick={handleClickInvites}
              multiline
              disabled={!exportedInvites}
            >
              <span className="title">{lang('GroupInfoInviteLinks')}</span>
              <span className="subtitle">
                {exportedInvites ? formatInteger(exportedInvites.length) : lang('Loading')}
              </span>
            </ListItem>
          )}
          {Boolean(chat.joinRequests?.length) && (
            <ListItem
              icon="add-user-filled"
              onClick={handleClickRequests}
              multiline
            >
              <span className="title">{lang('MemberRequests')}</span>
              <span className="subtitle">
                {formatInteger(chat.joinRequests.length)}
              </span>
            </ListItem>
          )}
        </Island>
        <Island>
          <ListItem icon="group" multiline onClick={handleClickMembers}>
            <span className="title">{lang('GroupMembers')}</span>
            <span className="subtitle">{formatInteger(chat.membersCount ?? 0)}</span>
          </ListItem>
        </Island>
        <Island>
          <ListItem icon="delete" ripple destructive onClick={openDeleteDialog}>
            {lang('DeleteMega')}
          </ListItem>
        </Island>
      </div>
      <FloatingActionButton
        isShown={isProfileFieldsTouched}
        onClick={handleUpdateGroup}
        disabled={isLoading}
        ariaLabel={lang('Save')}
        iconName="check"
        isLoading={isLoading}
      />
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={closeDeleteDialog}
        textParts={renderText(
          lang('AreYouSureDeleteAndExit'),
          ['br', 'simple_markdown'],
        )}
        confirmLabel={lang('DeleteMega')}
        confirmHandler={handleDeleteGroup}
        confirmIsDestructive
      />
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const chat = selectChat(global, chatId)!;
    const chatFullInfo = selectChatFullInfo(global, chatId);
    const { management } = selectTabState(global);
    const { progress } = management;
    const { invites } = management.byChatId[chatId] || {};
    const canChangeInfo = getHasAdminRight(chat, 'changeInfo');
    const canBanUsers = selectCanBanUsers(global, chatId);
    const canInvite = getHasAdminRight(chat, 'inviteUsers');

    return {
      chat,
      chatFullInfo,
      currentAvatarPhoto: selectPeerAvatarPhoto(global, chatId),
      progress,
      canChangeInfo,
      canBanUsers,
      canInvite,
      exportedInvites: invites,
    };
  },
  (global, { chatId }) => {
    return Boolean(selectChat(global, chatId));
  },
)(ManageGroup));
