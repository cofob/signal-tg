import {
  memo, useEffect, useState,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiAvatarUpload } from '../../../api/types';
import { ProfileEditProgress, SettingsScreens } from '../../../types';

import { getChatAvatarHash, getMainUsername } from '../../../global/helpers';
import { selectTabState, selectUser, selectUserFullInfo } from '../../../global/selectors';
import renderText from '../../common/helpers/renderText';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandDescription, IslandOutside, IslandTitle } from '../../gili/layout/Island';
import Surface from '../../gili/layout/Surface';
import AvatarEditable from '../../ui/AvatarEditable';
import FloatingActionButton from '../../ui/FloatingActionButton';
import InputText from '../../ui/InputText';
import ListItem from '../../ui/ListItem';
import TextArea from '../../ui/TextArea';

type OwnProps = {
  isActive: boolean;
  onReset: () => void;
};

type StateProps = {
  currentAvatarHash?: string;
  currentFirstName?: string;
  currentLastName?: string;
  currentBio?: string;
  currentUsername?: string;
  progress?: ProfileEditProgress;
};

// Signal Android `ProfileName.MAX_PART_LENGTH` and the about limit of Signal Desktop's profile editor
const MAX_NAME_LENGTH = 26;
const MAX_ABOUT_LENGTH = 140;
const ERROR_FIRST_NAME_MISSING = 'EditProfileNoFirstName';

const SettingsEditProfile = ({
  isActive,
  currentAvatarHash,
  currentFirstName,
  currentLastName,
  currentBio,
  currentUsername,
  progress,
  onReset,
}: OwnProps & StateProps) => {
  const { updateProfile, openSettingsScreen } = getActions();

  const lang = useLang();

  const [isProfileFieldsTouched, setIsProfileFieldsTouched] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [photo, setPhoto] = useState<ApiAvatarUpload | undefined>();
  const [isPhotoRemoved, setIsPhotoRemoved] = useState(false);
  const [firstName, setFirstName] = useState(currentFirstName || '');
  const [lastName, setLastName] = useState(currentLastName || '');
  const [bio, setBio] = useState(currentBio || '');

  const isLoading = progress === ProfileEditProgress.InProgress;
  const isSaveButtonShown = Boolean(photo) || isPhotoRemoved || isProfileFieldsTouched;

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  useEffect(() => {
    setPhoto(undefined);
    setIsPhotoRemoved(false);
  }, [currentAvatarHash]);

  useEffect(() => {
    setFirstName(currentFirstName || '');
    setLastName(currentLastName || '');
    setBio(currentBio || '');
  }, [currentFirstName, currentLastName, currentBio]);

  useEffect(() => {
    if (progress === ProfileEditProgress.Complete) {
      setPhoto(undefined);
      setIsPhotoRemoved(false);
      setIsProfileFieldsTouched(false);
      setError(undefined);
    }
  }, [progress]);

  const handlePhotoChange = useLastCallback((newPhoto: ApiAvatarUpload) => {
    setPhoto(newPhoto);
    setIsPhotoRemoved(false);
  });

  const handlePhotoRemove = useLastCallback(() => {
    setPhoto(undefined);
    setIsPhotoRemoved(true);
  });

  const handleFirstNameChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFirstName(e.target.value);
    setIsProfileFieldsTouched(true);
  });

  const handleLastNameChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLastName(e.target.value);
    setIsProfileFieldsTouched(true);
  });

  const handleBioChange = useLastCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBio(e.target.value);
    setIsProfileFieldsTouched(true);
  });

  const handleUsernameClick = useLastCallback(() => {
    openSettingsScreen({ screen: SettingsScreens.Username });
  });

  const handleProfileSave = useLastCallback(() => {
    const trimmedFirstName = firstName.trim();
    if (!trimmedFirstName.length) {
      setError(ERROR_FIRST_NAME_MISSING);
      return;
    }

    updateProfile({
      photo,
      shouldRemovePhoto: isPhotoRemoved || undefined,
      firstName: trimmedFirstName,
      lastName: lastName.trim(),
      bio: bio.trim(),
    });
  });

  const handleNameKeyDown = useLastCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.isComposing || !isSaveButtonShown || isLoading) return;

    e.preventDefault();
    handleProfileSave();
  });

  return (
    <div className="settings-fab-wrapper">
      <Surface scrollable className="settings-content no-border">
        <IslandOutside className="settings-content-header">
          <AvatarEditable
            isOwn
            currentAvatarHash={isPhotoRemoved ? undefined : currentAvatarHash}
            onChange={handlePhotoChange}
            title={lang('AriaSettingsEditProfilePhoto')}
            isLoading={isLoading}
          />
        </IslandOutside>
        {(currentAvatarHash || photo) && !isPhotoRemoved && (
          <Island>
            <ListItem icon="delete" destructive narrow disabled={isLoading} onClick={handlePhotoRemove}>
              {lang('SignalProfileRemovePhoto')}
            </ListItem>
          </Island>
        )}
        <Island>
          <div className="settings-input">
            <InputText
              value={firstName}
              onChange={handleFirstNameChange}
              onKeyDown={handleNameKeyDown}
              label={lang('FirstName')}
              disabled={isLoading}
              maxLength={MAX_NAME_LENGTH}
              error={error === ERROR_FIRST_NAME_MISSING ? lang(ERROR_FIRST_NAME_MISSING) : undefined}
            />
            <InputText
              value={lastName}
              onChange={handleLastNameChange}
              onKeyDown={handleNameKeyDown}
              label={lang('LastName')}
              disabled={isLoading}
              maxLength={MAX_NAME_LENGTH}
            />
            <TextArea
              value={bio}
              onChange={handleBioChange}
              label={lang('SignalProfileAbout')}
              disabled={isLoading}
              maxLength={MAX_ABOUT_LENGTH}
              maxLengthIndicator={(MAX_ABOUT_LENGTH - bio.length).toString()}
            />
          </div>
        </Island>
        <IslandDescription dir={lang.isRtl ? 'rtl' : undefined}>
          {renderText(lang('SignalProfileAboutHelp'), ['br', 'simple_markdown'])}
        </IslandDescription>

        <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('Username')}</IslandTitle>
        <Island>
          <ListItem
            icon="mention-filled"
            iconBg="blue"
            multiline
            narrow
            onClick={handleUsernameClick}
          >
            <span className="title">{currentUsername || lang('SignalUsernameSet')}</span>
            {currentUsername && <span className="subtitle">{lang('Username')}</span>}
          </ListItem>
        </Island>
        <IslandDescription dir={lang.isRtl ? 'rtl' : undefined}>
          {lang('SignalProfileUsernameHelp')}
        </IslandDescription>
      </Surface>

      <FloatingActionButton
        isShown={isSaveButtonShown}
        onClick={handleProfileSave}
        disabled={isLoading}
        ariaLabel={lang('Save')}
        iconName="check"
        isLoading={isLoading}
      />
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const { currentUserId } = global;
    const { profileEdit } = selectTabState(global);
    const currentUser = currentUserId ? selectUser(global, currentUserId) : undefined;
    const currentUserFullInfo = currentUserId ? selectUserFullInfo(global, currentUserId) : undefined;

    return {
      currentAvatarHash: currentUser && getChatAvatarHash(currentUser),
      currentFirstName: currentUser?.firstName,
      currentLastName: currentUser?.lastName,
      currentBio: currentUserFullInfo?.bio,
      currentUsername: currentUser && getMainUsername(currentUser),
      progress: profileEdit?.progress,
    };
  },
)(SettingsEditProfile));
