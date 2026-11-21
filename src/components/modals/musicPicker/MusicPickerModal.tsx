import {
  memo, useCallback, useEffect, useMemo, useState,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type {
  ApiAudio, ApiChat, ApiUserSavedMusic,
} from '../../../api/types';
import type { GlobalState, TabState } from '../../../global/types';
import type { MessageList, PlaybackItemRef, PlaybackSource } from '../../../types';
import { MAIN_THREAD_ID } from '../../../api/types';
import { LoadMoreDirection } from '../../../types';

import { SUPPORTED_AUDIO_CONTENT_TYPES } from '../../../config';
import { getChatNotifySettings } from '../../../global/helpers/notifications';
import {
  selectChat,
  selectChatMessage,
  selectNotifyDefaults,
  selectNotifyException,
  selectUserSavedMusic,
} from '../../../global/selectors';
import { revokeAttachmentUrls } from '../../../util/attachments';
import { validateFiles } from '../../../util/files';
import { buildCollectionByCallback } from '../../../util/iteratees';
import { parseSearchResultKey } from '../../../util/keys/searchResultKey';
import { MEMO_EMPTY_ARRAY } from '../../../util/memo';
import { openSystemFilesDialog } from '../../../util/systemFilesDialog';
import { MAX_UPLOAD_SIZE } from '../../../limits';
import buildAttachment from '../../middle/composer/helpers/buildAttachment';

import { useShallowSelector } from '../../../hooks/data/useSelector';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import useSchedule from '../../../hooks/useSchedule';

import Button from '../../ui/Button';
import InfiniteScroll from '../../ui/InfiniteScroll';
import Transition from '../../ui/Transition';
import MusicPickerRow from './MusicPickerRow';
import Interactive from '@gili/layout/Interactive';
import Island, { IslandTitle } from '@gili/layout/Island';
import Modal, {
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '@gili/modal/Modal';

import styles from './MusicPickerModal.module.scss';

export type OwnProps = {
  modal: NonNullable<TabState['musicPicker']>;
  isOpen: boolean;
};

type StateProps = {
  chat?: ApiChat;
  currentUserId?: string;
  savedMusic?: ApiUserSavedMusic;
  isSilentPosting?: boolean;
};

type TrackRowData = {
  key: string;
  audio: ApiAudio;
  item: PlaybackItemRef;
};

type SendContent = {
  audio?: ApiAudio;
  file?: File;
};

type RichInputMedia = Pick<NonNullable<TabState['requestedRichInputMedia']>, 'audio' | 'files'>;

const SCROLL_CONTAINER_SELECTOR = '.custom-scroll';
const SINGLE_SOURCE: PlaybackSource = { type: 'single' };
const AUDIO_FILES_ACCEPT = Array.from(SUPPORTED_AUDIO_CONTENT_TYPES).join(',');

const MusicPickerModal = ({
  modal,
  isOpen,
  chat,
  currentUserId,
  savedMusic,
  isSilentPosting,
}: OwnProps & StateProps) => {
  const {
    closeMusicPicker, loadSavedMusic, loadMusicPickerShared, requestRichInputMedia, sendMessage,
    openLimitReachedModal, showNotification,
  } = getActions();

  const lang = useLang();
  const [listGeneration, setListGeneration] = useState(0);
  const [requestCalendar, calendar] = useSchedule();

  const { shared } = modal;
  const isInScheduledList = modal.messageListType === 'scheduled';

  useEffect(() => {
    if (!isOpen) return;

    loadMusicPickerShared();
  }, [isOpen, loadMusicPickerShared]);

  useEffect(() => {
    if (!isOpen || !currentUserId || savedMusic) return;

    loadSavedMusic({ userId: currentUserId });
  }, [isOpen, currentUserId, savedMusic, loadSavedMusic]);

  const profileSource = useMemo<PlaybackSource | undefined>(() => (
    currentUserId ? { type: 'savedMusic', peerId: currentUserId } : undefined
  ), [currentUserId]);

  const profileRows = useMemo<TrackRowData[]>(() => {
    if (!savedMusic || !currentUserId) return MEMO_EMPTY_ARRAY;

    return savedMusic.ids.reduce<TrackRowData[]>((rows, audioId) => {
      const audio = savedMusic.byId[audioId];
      if (!audio) return rows;

      rows.push({
        key: audioId,
        audio,
        item: { type: 'savedMusic', peerId: currentUserId, audioId },
      });

      return rows;
    }, []);
  }, [savedMusic, currentUserId]);

  const sharedIds = shared?.ids;
  const sharedMessagesSelector = useCallback((global: GlobalState) => {
    if (!sharedIds) return undefined;

    return buildCollectionByCallback(sharedIds, (id) => {
      const [chatId, messageId] = parseSearchResultKey(id);
      return [id, selectChatMessage(global, chatId, messageId)];
    });
  }, [sharedIds]);
  const sharedMessagesById = useShallowSelector(sharedMessagesSelector);

  const sharedRows = useMemo<TrackRowData[]>(() => {
    if (!sharedIds || !sharedMessagesById) return MEMO_EMPTY_ARRAY;

    return sharedIds.reduce<TrackRowData[]>((rows, id) => {
      const message = sharedMessagesById[id];
      const audio = message?.content.audio;
      if (!message || !audio) return rows;

      rows.push({
        key: id,
        audio,
        item: {
          type: 'message', chatId: message.chatId, threadId: MAIN_THREAD_ID, messageId: message.id,
        },
      });

      return rows;
    }, []);
  }, [sharedIds, sharedMessagesById]);

  const messageList = useMemo<MessageList>(() => ({
    chatId: modal.chatId,
    threadId: modal.threadId,
    type: isInScheduledList ? 'scheduled' : 'thread',
  }), [modal.chatId, modal.threadId, isInScheduledList]);

  const handleLoadMore = useLastCallback(({ direction }: { direction: LoadMoreDirection }) => {
    if (direction !== LoadMoreDirection.Backwards) return;

    if (shared && !shared.isFullyLoaded) {
      loadMusicPickerShared();
    }
  });

  const handleTransitionStop = useLastCallback(() => {
    setListGeneration(listGeneration + 1);
  });

  const handleShowMore = useLastCallback(() => {
    if (!currentUserId) return;

    loadSavedMusic({ userId: currentUserId });
  });

  const showSkippedFileNotification = useLastCallback(() => {
    showNotification({ message: lang('RichMediaSkippedFiles', { count: 1 }, { pluralValue: 1 }) });
  });

  const submitContent = useLastCallback(async (
    { audio, file }: SendContent, scheduledAt?: number,
  ) => {
    closeMusicPicker();

    const attachment = file && await buildAttachment(file.name, file);
    if (attachment && !attachment.audio) {
      revokeAttachmentUrls(attachment);
      showSkippedFileNotification();
      return;
    }

    sendMessage({
      messageList,
      audio,
      attachments: attachment && [attachment],
      isSilent: scheduledAt ? undefined : isSilentPosting,
      scheduledAt,
    });
  });

  const handleSubmit = useLastCallback((content: SendContent) => {
    if (isInScheduledList) {
      requestCalendar((scheduledAt) => {
        submitContent(content, scheduledAt);
      });
      return;
    }

    submitContent(content);
  });

  const insertToRichInput = useLastCallback((media: RichInputMedia) => {
    requestRichInputMedia({
      chatId: modal.chatId,
      threadId: modal.threadId,
      messageListType: modal.messageListType,
      ...media,
    });
    closeMusicPicker();
  });

  const handleSend = useLastCallback((audio: ApiAudio) => {
    if (modal.shouldInsertToRichInput) {
      insertToRichInput({ audio });
      return;
    }

    handleSubmit({ audio });
  });

  const handleSelectFromFiles = useLastCallback(() => {
    openSystemFilesDialog(AUDIO_FILES_ACCEPT, (e) => {
      const file = validateFiles((e.target as HTMLInputElement).files)?.[0];
      if (!file) return;

      if (!SUPPORTED_AUDIO_CONTENT_TYPES.has(file.type)) {
        showSkippedFileNotification();
        return;
      }

      if (modal.shouldInsertToRichInput) {
        insertToRichInput({ files: [file] });
        return;
      }

      if (file.size > MAX_UPLOAD_SIZE) {
        openLimitReachedModal({ limit: 'uploadMaxFileparts' });
        return;
      }

      handleSubmit({ file });
    }, true);
  });

  const isProfileLoading = !savedMusic?.isLoaded && !profileRows.length;
  const isSharedLoading = Boolean(shared?.isLoading);
  const isDefaultReady = shared !== undefined && !(isSharedLoading && !sharedRows.length) && !isProfileLoading;

  const shouldShowProfileMore = savedMusic !== undefined && !savedMusic.isFullyLoaded && !isProfileLoading;

  const header = useMemo(() => (
    <ModalHeader>
      <ModalCloseButton />
      <ModalTitle>{lang('AttachMusic')}</ModalTitle>
    </ModalHeader>
  ), [lang]);

  function renderRows(rows: TrackRowData[], source: PlaybackSource) {
    return rows.map(({ key, audio, item }) => (
      <MusicPickerRow
        key={key}
        audio={audio}
        item={item}
        source={source}
        onSend={handleSend}
      />
    ));
  }

  function renderEmpty() {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>{lang('NoAudioFiles')}</div>
        <div className={styles.emptyDescription}>{lang('NoAudioFilesInfo')}</div>
      </div>
    );
  }

  function renderDefaultLists() {
    if (!profileRows.length && !sharedRows.length) {
      return renderEmpty();
    }

    return (
      <>
        {profileRows.length > 0 && profileSource && (
          <>
            <IslandTitle>{lang('AudioSearchProfile')}</IslandTitle>
            <Island className={styles.island}>
              {renderRows(profileRows, profileSource)}
              {shouldShowProfileMore && (
                <Button
                  className={styles.showMore}
                  isText
                  size="smaller"
                  noForcedUpperCase
                  onClick={handleShowMore}
                >
                  {lang('ShowMore')}
                </Button>
              )}
            </Island>
          </>
        )}
        {sharedRows.length > 0 && (
          <>
            <IslandTitle>{lang('AudioSearchChats')}</IslandTitle>
            <Island className={styles.island}>
              {renderRows(sharedRows, SINGLE_SOURCE)}
            </Island>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={closeMusicPicker}
        header={header}
        ariaLabel={lang('AttachMusic')}
        width="slim"
        dialogClassName={styles.dialog}
        contentClassName={styles.content}
      >
        <InfiniteScroll
          scrollContainerClosest={SCROLL_CONTAINER_SELECTOR}
          items={sharedIds}
          cacheBuster={listGeneration}
          itemSelector={`.${styles.row}`}
          onLoadMore={handleLoadMore}
          noScrollRestore
          noFastList
        >
          <Island className={styles.filesIsland}>
            <Interactive clickable ripple className={styles.filesButton} onClick={handleSelectFromFiles}>
              {lang('AttachmentSelectFromFiles')}
            </Interactive>
          </Island>
          <Transition name="fade" activeKey={Number(isDefaultReady)} shouldCleanup onStop={handleTransitionStop}>
            {isDefaultReady ? renderDefaultLists() : undefined}
          </Transition>
        </InfiniteScroll>
      </Modal>
      {calendar}
    </>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { modal }): Complete<StateProps> => {
    const { currentUserId } = global;
    const chat = selectChat(global, modal.chatId);

    return {
      chat,
      currentUserId,
      savedMusic: currentUserId ? selectUserSavedMusic(global, currentUserId) : undefined,
      isSilentPosting: chat ? getChatNotifySettings(
        chat,
        selectNotifyDefaults(global),
        selectNotifyException(global, chat.id),
      )?.isSilentPosting : undefined,
    };
  },
)(MusicPickerModal));
