import {
  memo, useMemo, useRef,
} from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type {
  ApiChat,
  ApiCountryCode,
  ApiUser,
  ApiUserFullInfo,
  ApiUsername,
} from '../../../api/types';
import type { RegularLangKey } from '../../../types/language';

import {
  MUTE_INDEFINITE_TIMESTAMP, UNMUTE_TIMESTAMP,
} from '../../../config';
import { getChatLink, getHasAdminRight, isUserRightBanned } from '../../../global/helpers';
import { getIsChatMuted } from '../../../global/helpers/notifications';
import { getPeerTitle } from '../../../global/helpers/peers';
import {
  selectChat,
  selectChatFullInfo,
  selectIsChatRestricted,
  selectNotifyDefaults,
  selectNotifyException,
  selectUser,
  selectUserFullInfo,
} from '../../../global/selectors';
import { VTT_PROFILE_NOTE_COLLAPSE, VTT_PROFILE_NOTE_EXPAND } from '../../../util/animations/viewTransitionTypes';
import buildClassName from '../../../util/buildClassName';
import { copyTextToClipboard } from '../../../util/clipboard';
import { formatPhoneNumberWithCode } from '../../../util/phoneNumber';
import stopEvent from '../../../util/stopEvent';
import formatUsername from '../helpers/formatUsername';
import renderText from '../helpers/renderText';
import { renderTextWithEntities } from '../helpers/renderTextWithEntities';

import { useViewTransition } from '../../../hooks/animations/useViewTransition';
import { useVtn } from '../../../hooks/animations/useVtn';
import useCollapsibleLines from '../../../hooks/element/useCollapsibleLines';
import useEffectWithPrevDeps from '../../../hooks/useEffectWithPrevDeps';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island from '../../gili/layout/Island';
import Switch from '../../gili/primitives/Switch';
import Button from '../../ui/Button';
import ListItem from '../../ui/ListItem';
import Icon from '../icons/Icon';
import QrIcon from '../icons/QrIcon';
import UserBirthday from './UserBirthday';

import styles from './ChatExtra.module.scss';

type OwnProps = {
  chatOrUserId: string;
  isOwnProfile?: boolean;
  isInSettings?: boolean;
  className?: string;
  style?: string;
};

type StateProps = {
  user?: ApiUser;
  chat?: ApiChat;
  userFullInfo?: ApiUserFullInfo;
  canInviteUsers?: boolean;
  isMuted?: boolean;
  phoneCodeList: ApiCountryCode[];
  description?: string;
  chatInviteLink?: string;
};

const NOTE_MAX_LINES = 3;

const ChatExtra = ({
  chatOrUserId,
  user,
  chat,
  userFullInfo,
  isOwnProfile,
  canInviteUsers,
  isMuted,
  phoneCodeList,
  description,
  chatInviteLink,
  className,
  style,
  isInSettings,
}: OwnProps & StateProps) => {
  const {
    showNotification,
    updateChatMutedState,
    loadPeerStories,
    openQrCodeModal,
    openSafetyNumberModal,
  } = getActions();

  const {
    id: userId,
    usernames,
    phoneNumber,
    isSelf,
  } = user || {};
  const { id: chatId, usernames: chatUsernames } = chat || {};
  const peerId = userId || chatId;
  const { birthday, note } = userFullInfo || {};

  const lang = useLang();

  const { startViewTransition } = useViewTransition();
  const { createVtnStyle } = useVtn();

  const noteTextRef = useRef<HTMLDivElement>();

  const shouldRenderNote = Boolean(note);

  const {
    isCollapsed: isNoteCollapsed,
    isCollapsible: isNoteCollapsible,
    setIsCollapsed: setIsNoteCollapsed,
  } = useCollapsibleLines(
    noteTextRef,
    NOTE_MAX_LINES,
    { isDisabled: !shouldRenderNote },
  );

  useEffectWithPrevDeps(([prevPeerId]) => {
    if (!peerId || prevPeerId === peerId) return;
    if (user) {
      loadPeerStories({ peerId });
    }
  }, [peerId, chat, user]);

  const activeUsernames = useMemo(() => {
    const result = usernames?.filter((u) => u.isActive);

    return result?.length ? result : undefined;
  }, [usernames]);

  const activeChatUsernames = useMemo(() => {
    const result = !user ? chatUsernames?.filter((u) => u.isActive) : undefined;

    return result?.length ? result : undefined;
  }, [chatUsernames, user]);

  const link = useMemo(() => {
    if (!chat) {
      return undefined;
    }

    return getChatLink(chat) || chatInviteLink;
  }, [chat, chatInviteLink]);

  const handleToggleNotifications = useLastCallback(() => {
    const mutedUntil = isMuted ? UNMUTE_TIMESTAMP : MUTE_INDEFINITE_TIMESTAMP;
    updateChatMutedState({ chatId: chatId!, mutedUntil });
  });

  const canExpandNote = isNoteCollapsible && isNoteCollapsed;

  const handleExpandNote = useLastCallback(() => {
    startViewTransition(VTT_PROFILE_NOTE_EXPAND, () => {
      setIsNoteCollapsed(false);
    });
  });

  const handleToggleNote = useLastCallback(() => {
    const isCollapsed = isNoteCollapsed;
    startViewTransition(isCollapsed ? VTT_PROFILE_NOTE_EXPAND : VTT_PROFILE_NOTE_COLLAPSE, () => {
      setIsNoteCollapsed(() => !isCollapsed);
    });
  });

  function copy(text: string, key: RegularLangKey) {
    copyTextToClipboard(text);
    showNotification({ message: { key } });
  }

  const formattedNumber = phoneNumber && formatPhoneNumberWithCode(phoneCodeList, phoneNumber);

  const handlePhoneClick = useLastCallback(() => {
    copy(formattedNumber!, 'PhoneCopied');
  });

  const handleUsernameClick = useLastCallback((username: ApiUsername, isChat?: boolean) => {
    copy(formatUsername(username.username, isChat), isChat ? 'LinkCopied' : 'UsernameCopied');
  });

  const handleOpenQrCode = useLastCallback((e: React.MouseEvent) => {
    stopEvent(e);
    if (!peerId) return;
    openQrCodeModal({ peerId });
  });

  const handleOpenSafetyNumber = useLastCallback(() => {
    openSafetyNumberModal({ userId: userId! });
  });

  const isRestricted = chatId ? selectIsChatRestricted(getGlobal(), chatId) : false;
  if (isRestricted || (isSelf && !isOwnProfile && !isInSettings)) {
    return undefined;
  }

  function renderUsernames(usernameList: ApiUsername[], isChat?: boolean) {
    const [mainUsername, ...otherUsernames] = usernameList;

    const usernameLinks = otherUsernames.length ? lang('UsernameAlso', {
      usernames: otherUsernames.map((username, index) => (
        <>
          {index > 0 ? ', ' : ''}
          <a
            key={username.username}
            href={formatUsername(username.username, true)}
            onMouseDown={stopEvent}
            onClick={(e) => {
              stopEvent(e);
              handleUsernameClick(username, isChat);
            }}
            className="text-entity-link username-link"
          >
            {formatUsername(username.username)}
          </a>
        </>
      )),
    }, { withNodes: true }) : undefined;

    return (
      <ListItem
        icon={isChat ? 'link' : 'mention-filled'}
        iconBg={isChat ? 'orange' : 'blue'}
        multiline
        narrow
        ripple
        rightElement={(
          <Button
            round
            size="smaller"
            color="translucent"
            ariaLabel={lang('QrCodeTitle')}
            onClick={handleOpenQrCode}
          >
            <QrIcon />
          </Button>
        )}
        onClick={() => {
          handleUsernameClick(mainUsername, isChat);
        }}
      >
        <span className="title" dir={lang.isRtl ? 'rtl' : undefined}>
          {formatUsername(mainUsername.username, isChat)}
        </span>
        <span className="subtitle">
          {Boolean(otherUsernames.length) && <span className="other-usernames">{usernameLinks}</span>}
          {lang(isChat ? 'SetUrlPlaceholder' : 'Username')}
        </span>
      </ListItem>
    );
  }

  return (
    <div className={buildClassName('ChatExtra', className)} style={style || createVtnStyle('chatExtra')}>
      {user && userFullInfo?.isUnofficialSecurityRisk && (
        <Island className={styles.securityRiskIsland}>
          <div className={styles.unofficialSecurityRisk}>
            <Icon className={buildClassName(styles.riskIcon, 'in-text-icon')} name="info-filled" />
            {lang('UnofficialSecurityRisk', { peer: getPeerTitle(lang, user) })}
          </div>
        </Island>
      )}
      <Island>
        {Boolean(formattedNumber?.length) && (
          <ListItem
            icon="phone-filled"
            iconBg="green"
            className={styles.phone}
            multiline
            narrow
            ripple
            onClick={handlePhoneClick}
            style={createVtnStyle('phone')}
          >
            <span className="title" dir={lang.isRtl ? 'rtl' : undefined}>{formattedNumber}</span>
            <span className="subtitle">{lang('Phone')}</span>
          </ListItem>
        )}
        {activeUsernames && renderUsernames(activeUsernames)}
        {description && Boolean(description.length) && (
          <ListItem
            icon="info-filled"
            iconBg="gray"
            className={styles.description}
            multiline
            narrow
            isStatic
            allowSelection
            style={createVtnStyle('description')}
          >
            <span className="title word-break allow-selection" dir={lang.isRtl ? 'rtl' : undefined}>
              {renderText(description, ['br', 'app_links', 'emoji'])}
            </span>
            <span className="subtitle">{lang(userId ? 'UserBio' : 'Info')}</span>
          </ListItem>
        )}
        {activeChatUsernames && renderUsernames(activeChatUsernames, true)}
        {!activeChatUsernames && canInviteUsers && link && (
          <ListItem
            icon="link"
            iconBg="orange"
            multiline
            className={styles.link}
            narrow
            ripple
            onClick={() => copy(link, 'LinkCopied')}
            style={createVtnStyle('link')}
          >
            <div className="title">{link}</div>
            <span className="subtitle">{lang('SetUrlPlaceholder')}</span>
          </ListItem>
        )}
        {birthday && (
          <UserBirthday key={peerId} birthday={birthday} user={user!} isInSettings={isInSettings} />
        )}
        {!isOwnProfile && !isInSettings && (
          <ListItem
            icon="notifications-filled"
            iconBg="red"
            className={styles.notifications}
            narrow
            ripple
            onClick={handleToggleNotifications}
            style={createVtnStyle('notifications')}
          >
            <span>{lang('Notifications')}</span>
            <Switch
              id="group-notifications"
              checked={!isMuted}
              className={styles.switch}
            />
          </ListItem>
        )}
        {user && !isSelf && !isOwnProfile && !isInSettings && (
          <ListItem
            icon="lock"
            iconBg="gray"
            narrow
            ripple
            onClick={handleOpenSafetyNumber}
            style={createVtnStyle('safetyNumber')}
          >
            <span>{lang('SafetyNumberView')}</span>
          </ListItem>
        )}
        {shouldRenderNote && (
          <ListItem
            icon="note-filled"
            iconBg="green"
            multiline
            narrow
            isStatic
            allowSelection
            className={styles.note}
            style={createVtnStyle('note')}
          >
            <div
              ref={noteTextRef}
              className={buildClassName(
                'title',
                'word-break',
                'allow-selection',
                styles.noteText,
                isNoteCollapsed && styles.noteTextCollapsed,
              )}
              style={createVtnStyle('noteText', true)}
              dir={lang.isRtl ? 'rtl' : undefined}
              onClick={canExpandNote ? handleExpandNote : undefined}
            >
              {renderTextWithEntities({
                text: note.text,
                entities: note.entities,
              })}
            </div>
            <div className={buildClassName('subtitle', styles.noteSubtitle)} style={createVtnStyle('noteSubtitle')}>
              <span>{lang('UserNoteTitle')}</span>

              <span className={styles.noteHint}>{lang('UserNoteHint')}</span>
              {isNoteCollapsible && (
                <Icon
                  className={buildClassName(
                    styles.noteExpandIcon,
                    styles.clickable,
                  )}
                  style={createVtnStyle('noteExpandIcon', true)}
                  onClick={handleToggleNote}
                  name={isNoteCollapsed ? 'down' : 'up'}
                />
              )}
            </div>
          </ListItem>
        )}
      </Island>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatOrUserId }): Complete<StateProps> => {
    const { countryList: { phoneCodes: phoneCodeList } } = global;

    const chat = chatOrUserId ? selectChat(global, chatOrUserId) : undefined;
    const user = chatOrUserId ? selectUser(global, chatOrUserId) : undefined;
    const isMuted = chat && getIsChatMuted(chat, selectNotifyDefaults(global), selectNotifyException(global, chat.id));

    const chatFullInfo = chat && selectChatFullInfo(global, chat.id);
    const userFullInfo = user && selectUserFullInfo(global, user.id);

    const chatInviteLink = chatFullInfo?.inviteLink;
    const description = userFullInfo?.bio || chatFullInfo?.about;

    const canInviteUsers = chat && !user && (
      !isUserRightBanned(chat, 'inviteUsers') || getHasAdminRight(chat, 'inviteUsers')
    );

    return {
      phoneCodeList,
      chat,
      user,
      userFullInfo,
      canInviteUsers,
      isMuted,
      chatInviteLink,
      description,
    };
  },
)(ChatExtra));
