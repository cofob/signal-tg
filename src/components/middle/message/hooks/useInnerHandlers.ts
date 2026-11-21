import { getActions } from '../../../../global';

import type { ApiMessage, ApiPeer, ApiStory, ApiWebPage } from '../../../../api/types';
import type { IAlbum, ThreadId } from '../../../../types';
import { MAIN_THREAD_ID } from '../../../../api/types';
import { MediaViewerOrigin } from '../../../../types';

import { getMessagePhoto, getWebPagePhoto, getWebPageVideo } from '../../../../global/helpers';
import { getMessageReplyInfo } from '../../../../global/helpers/replies';
import { getRichQuoteText } from '../../../../util/text/richQuote';

import useLastCallback from '../../../../hooks/useLastCallback';

export default function useInnerHandlers({
  selectMessage,
  message,
  webPage,
  chatId,
  threadId,
  isInDocumentGroup,
  asForwarded,
  isScheduled,
  album,
  senderPeer,
  story,
  isReplyPrivate,
  isSavedMessages,
  lastPlaybackTimestamp,
}: {
  selectMessage: (e: React.MouseEvent<HTMLDivElement, MouseEvent>, groupedId?: string) => void;
  message: ApiMessage;
  webPage?: ApiWebPage;
  chatId: string;
  threadId: ThreadId;
  isInDocumentGroup: boolean;
  asForwarded?: boolean;
  isScheduled?: boolean;
  album?: IAlbum;
  avatarPeer?: ApiPeer;
  senderPeer?: ApiPeer;
  story?: ApiStory;
  isReplyPrivate?: boolean;
  isSavedMessages?: boolean;
  lastPlaybackTimestamp?: number;
}) {
  const {
    openChat, showNotification, focusMessage, openMediaViewer, openAudioPlayer,
    markMessagesRead, cancelUploadMedia, openForwardMenu,
    openStoryViewer, searchChatMediaMessages,
  } = getActions();

  const {
    id: messageId, forwardInfo, groupedId, content: { video },
  } = message;

  const {
    replyToMsgId, replyToPeerId, replyToTopId, isQuote, quoteText, quoteRich, quoteOffset, pollOption,
  } = getMessageReplyInfo(message) || {};

  const handleSenderClick = useLastCallback(() => {
    if (!senderPeer) {
      showNotification({
        message: {
          key: 'HidAccount',
          options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
        },
      });

      return;
    }

    if (asForwarded && forwardInfo?.channelPostId) {
      focusMessage({ chatId: senderPeer.id, messageId: forwardInfo.channelPostId });
    } else {
      openChat({ id: senderPeer.id });
    }
  });

  const handleReplyClick = useLastCallback((): void => {
    if (!replyToMsgId || isReplyPrivate) {
      showNotification({
        message: {
          key: isQuote ? 'QuotePrivate' : 'ReplyPrivate',
          options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
        },
      });
      return;
    }

    focusMessage({
      chatId: replyToPeerId || chatId,
      threadId,
      messageId: replyToMsgId,
      replyMessageId: replyToPeerId ? undefined : messageId,
      quote: isQuote ? quoteRich?.map(getRichQuoteText).join('\n') || quoteText?.text : undefined,
      quoteOffset: isQuote ? quoteOffset : undefined,
      pollOption,
    });
  });

  const handleDocumentClick = useLastCallback((): void => {
    openMediaViewer({
      chatId,
      threadId,
      messageId,
      origin: message.isEphemeral
        ? MediaViewerOrigin.Ephemeral
        : isScheduled ? MediaViewerOrigin.ScheduledInline : MediaViewerOrigin.Inline,
    });
  });

  const openMediaViewerWithPhotoOrVideo = useLastCallback((withDynamicLoading: boolean): void => {
    if (withDynamicLoading && !message.isEphemeral) {
      searchChatMediaMessages({
        chatId, threadId, currentMediaMessageId: messageId, mediaType: video?.isGif ? 'gif' : 'media',
      });
    }

    const videoContent = video || getWebPageVideo(webPage);

    openMediaViewer({
      chatId,
      threadId,
      messageId,
      origin: message.isEphemeral
        ? MediaViewerOrigin.Ephemeral
        : isScheduled ? MediaViewerOrigin.ScheduledInline : MediaViewerOrigin.Inline,
      timestamp: lastPlaybackTimestamp || videoContent?.timestamp,
      withDynamicLoading: message.isEphemeral ? false : withDynamicLoading,
    });
  });
  const handlePhotoMediaClick = useLastCallback((): void => {
    const withDynamicLoading = !message.isEphemeral && !isScheduled;
    openMediaViewerWithPhotoOrVideo(withDynamicLoading);
  });
  const handleVideoMediaClick = useLastCallback(() => {
    const withDynamicLoading = !message.isEphemeral && !isScheduled;
    openMediaViewerWithPhotoOrVideo(withDynamicLoading);
  });

  const handleMediaClick = useLastCallback((): void => {
    const photo = getMessagePhoto(message) || getWebPagePhoto(webPage);
    if (photo) {
      handlePhotoMediaClick();
    }

    handleVideoMediaClick();
  });

  const handleAudioPlay = useLastCallback((): void => {
    openAudioPlayer({
      item: {
        type: 'message', chatId, threadId, messageId, isScheduled,
      },
    });
  });

  const handleAlbumMediaClick = useLastCallback((albumMessageId: number, albumIndex?: number): void => {
    searchChatMediaMessages({ chatId, threadId, currentMediaMessageId: messageId });
    openMediaViewer({
      chatId,
      threadId,
      messageId: albumMessageId,
      mediaIndex: albumIndex,
      origin: isScheduled ? MediaViewerOrigin.ScheduledAlbum : MediaViewerOrigin.Album,
      withDynamicLoading: true,
    });
  });

  const handleReadMedia = useLastCallback((): void => {
    if (message.isEphemeral) return;
    markMessagesRead({ chatId, messageIds: [messageId] });
  });

  const handleCancelUpload = useLastCallback(() => {
    cancelUploadMedia({ chatId, messageId });
  });

  const handleGroupForward = useLastCallback(() => {
    openForwardMenu({ fromChatId: chatId, groupedId });
  });

  const handleForward = useLastCallback(() => {
    if (album && album.messages) {
      const messageIds = album.messages.map(({ id }) => id);
      openForwardMenu({ fromChatId: chatId, messageIds });
    } else {
      openForwardMenu({ fromChatId: chatId, messageIds: [messageId] });
    }
  });

  const handleFocus = useLastCallback(() => {
    focusMessage({
      chatId, threadId: MAIN_THREAD_ID, messageId,
    });
  });

  const handleFocusForwarded = useLastCallback(() => {
    const originalChatId = (isSavedMessages && forwardInfo!.savedFromPeerId) || forwardInfo!.fromChatId!;

    if (isInDocumentGroup) {
      focusMessage({
        chatId: originalChatId, groupedId, groupedChatId: chatId, messageId: forwardInfo!.fromMessageId!,
      });
      return;
    }

    if (replyToPeerId && replyToTopId) {
      focusMessage({
        chatId: replyToPeerId,
        threadId: replyToTopId,
        messageId: forwardInfo!.fromMessageId!,
      });
    } else {
      focusMessage({
        chatId: originalChatId, messageId: forwardInfo!.fromMessageId!,
      });
    }
  });

  const selectWithGroupedId = useLastCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();

    selectMessage(e, groupedId);
  });

  const handleStoryClick = useLastCallback(() => {
    if (!story) return;
    openStoryViewer({
      peerId: story.peerId,
      storyId: story.id,
      isSingleStory: true,
    });
  });

  return {
    handleSenderClick,
    handleReplyClick,
    handleDocumentClick,
    handleMediaClick,
    handleAudioPlay,
    handleAlbumMediaClick,
    handlePhotoMediaClick,
    handleVideoMediaClick,
    handleMetaClick: selectWithGroupedId,
    handleReadMedia,
    handleCancelUpload,
    handleGroupForward,
    handleForward,
    handleFocus,
    handleFocusForwarded,
    handleDocumentGroupSelectAll: selectWithGroupedId,
    handleStoryClick,
  };
}
