import {
  memo, useEffect, useState,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { TabState } from '../../../global/types';
import type { RegularLangKey } from '../../../types/language';

import { getMainUsername } from '../../../global/helpers';
import { selectTabState, selectUser } from '../../../global/selectors';
import buildClassName from '../../../util/buildClassName';
import { copyTextToClipboard } from '../../../util/clipboard';

import useDebouncedCallback from '../../../hooks/useDebouncedCallback';
import useFlag from '../../../hooks/useFlag';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import SignalQrCode from '../../common/SignalQrCode';
import Island, { IslandDescription, IslandTitle } from '../../gili/layout/Island';
import ConfirmDialog from '../../ui/ConfirmDialog';
import FloatingActionButton from '../../ui/FloatingActionButton';
import InputText from '../../ui/InputText';
import ListItem from '../../ui/ListItem';

import styles from './SettingsUsername.module.scss';

type OwnProps = {
  isActive?: boolean;
  onReset: NoneToVoidFunction;
};

type StateProps = {
  currentUsername?: string;
  usernameEdit?: TabState['usernameEdit'];
};

const RESERVE_DEBOUNCE_MS = 500;
const QR_SIZE = 200;
// `UsernameErrorKey` of `src/api/signal/methods/profile.ts`
const ERROR_LANG_KEYS: Record<string, RegularLangKey> = {
  taken: 'SignalUsernameTaken',
  reservationExpired: 'SignalUsernameExpired',
  rateLimited: 'SignalUsernameRateLimited',
  nicknameTooShort: 'SignalUsernameTooShort',
  nicknameTooLong: 'SignalUsernameTooLong',
  nicknameStartsWithDigit: 'SignalUsernameStartsWithDigit',
  nicknameCharacters: 'SignalUsernameCharacters',
  discriminatorInvalid: 'SignalUsernameNumberInvalid',
};

/**
 * Signal usernames are a nickname and a number (Signal Desktop `EditUsernameModalBody`). Typing reserves the
 * username with a free number, or with the number typed; saving sets the reservation.
 */
const SettingsUsername = ({
  isActive,
  currentUsername,
  usernameEdit,
  onReset,
}: OwnProps & StateProps) => {
  const {
    reserveUsername, confirmUsername, deleteUsername, loadUsernameLink, resetUsernameLink, resetUsernameEdit,
    showNotification,
  } = getActions();

  const lang = useLang();

  const [currentNickname, currentDiscriminator] = splitUsername(currentUsername);
  const [nickname, setNickname] = useState(currentNickname);
  const [discriminator, setDiscriminator] = useState(currentDiscriminator);
  const [isDeleteDialogOpen, openDeleteDialog, closeDeleteDialog] = useFlag();
  const [isResetDialogOpen, openResetDialog, closeResetDialog] = useFlag();

  const {
    reservedUsername, isReserving, isSaving, error, link,
  } = usernameEdit || {};
  const typedUsername = `${nickname}.${discriminator}`;
  const isChanged = Boolean(nickname) && typedUsername !== currentUsername;

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  useEffect(() => {
    if (!isActive) return;
    resetUsernameEdit();
    loadUsernameLink();
  }, [isActive, currentUsername]);

  useEffect(() => {
    setNickname(currentNickname);
    setDiscriminator(currentDiscriminator);
  }, [currentNickname, currentDiscriminator]);

  // The server picks the number for a new nickname
  useEffect(() => {
    if (reservedUsername) setDiscriminator(splitUsername(reservedUsername)[1]);
  }, [reservedUsername]);

  const reserveDebounced = useDebouncedCallback((newNickname: string, newDiscriminator?: string) => {
    reserveUsername({ nickname: newNickname, discriminator: newDiscriminator });
  }, [], RESERVE_DEBOUNCE_MS, true);

  const handleNicknameChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    setNickname(value);
    if (value && value !== currentNickname) reserveDebounced(value);
  });

  const handleDiscriminatorChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    setDiscriminator(value);
    if (nickname && `${nickname}.${value}` !== currentUsername) reserveDebounced(nickname, value);
  });

  const handleSave = useLastCallback(() => {
    confirmUsername();
  });

  const handleDelete = useLastCallback(() => {
    closeDeleteDialog();
    deleteUsername();
  });

  const handleResetLink = useLastCallback(() => {
    closeResetDialog();
    resetUsernameLink();
  });

  const handleCopyLink = useLastCallback(() => {
    copyTextToClipboard(link!);
    showNotification({ message: { key: 'LinkCopied' } });
  });

  function renderStatus() {
    if (!isChanged) return undefined;
    if (isReserving) return <div className={styles.status}>{lang('Checking')}</div>;
    if (error) {
      return (
        <div className={buildClassName(styles.status, styles.error)}>
          {lang(ERROR_LANG_KEYS[error] ?? 'SignalUsernameFailed')}
        </div>
      );
    }
    if (reservedUsername !== typedUsername) return undefined;
    return (
      <div className={buildClassName(styles.status, styles.success)}>
        {lang('UsernameAvailable', { username: reservedUsername })}
      </div>
    );
  }

  const isSaveShown = isChanged && reservedUsername === typedUsername && !isReserving;

  return (
    <div className="settings-fab-wrapper">
      <div className="settings-content custom-scroll">
        <Island>
          <div className={styles.inputs}>
            <InputText
              className={styles.nickname}
              value={nickname}
              label={lang('Username')}
              readOnly={isSaving}
              onChange={handleNicknameChange}
              teactExperimentControlled
            />
            <InputText
              className={styles.discriminator}
              value={discriminator}
              label={lang('SignalUsernameNumber')}
              inputMode="numeric"
              readOnly={isSaving || !nickname}
              onChange={handleDiscriminatorChange}
              teactExperimentControlled
            />
          </div>
          {renderStatus()}
        </Island>
        <IslandDescription dir={lang.isRtl ? 'rtl' : undefined}>
          {lang('SignalUsernameHelp')}
        </IslandDescription>

        {currentUsername && (
          <>
            <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('SignalUsernameLink')}</IslandTitle>
            <Island>
              {link && (
                <div className={styles.link}>
                  <SignalQrCode data={link} size={QR_SIZE} />
                  <span className={styles.linkText}>{link}</span>
                </div>
              )}
              <ListItem icon="copy" narrow disabled={!link} onClick={handleCopyLink}>
                {lang('CopyLink')}
              </ListItem>
              <ListItem icon="reload" narrow onClick={openResetDialog}>
                {lang('SignalUsernameLinkReset')}
              </ListItem>
            </Island>
            <IslandDescription dir={lang.isRtl ? 'rtl' : undefined}>
              {lang('SignalUsernameLinkHelp')}
            </IslandDescription>

            <Island>
              <ListItem icon="delete" destructive narrow onClick={openDeleteDialog}>
                {lang('SignalUsernameDelete')}
              </ListItem>
            </Island>
          </>
        )}
      </div>

      <FloatingActionButton
        isShown={isSaveShown}
        onClick={handleSave}
        disabled={isSaving}
        ariaLabel={lang('Save')}
        iconName="check"
        isLoading={isSaving}
      />

      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        title={lang('SignalUsernameDelete')}
        text={lang('SignalUsernameDeleteConfirm', { username: currentUsername })}
        confirmLabel={lang('Delete')}
        confirmIsDestructive
        confirmHandler={handleDelete}
        onClose={closeDeleteDialog}
      />
      <ConfirmDialog
        isOpen={isResetDialogOpen}
        title={lang('SignalUsernameLinkReset')}
        text={lang('SignalUsernameResetConfirm')}
        confirmLabel={lang('Reset')}
        confirmIsDestructive
        confirmHandler={handleResetLink}
        onClose={closeResetDialog}
      />
    </div>
  );
};

function splitUsername(username?: string): [string, string] {
  if (!username) return ['', ''];
  const separator = username.lastIndexOf('.');
  return [username.slice(0, separator), username.slice(separator + 1)];
}

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const currentUser = global.currentUserId ? selectUser(global, global.currentUserId) : undefined;

    return {
      currentUsername: currentUser && getMainUsername(currentUser),
      usernameEdit: selectTabState(global).usernameEdit,
    };
  },
)(SettingsUsername));
