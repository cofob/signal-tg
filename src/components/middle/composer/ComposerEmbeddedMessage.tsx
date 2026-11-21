import {
  memo, useEffect, useMemo, useRef,
} from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type {
  ApiChat, ApiInputDraftReplyInfo, ApiMessage, ApiPeer,
} from '../../../api/types';
import type { MessageListType, ThreadId } from '../../../types/index';

import { canEditMediaInEditor } from '../../../global/helpers';
import {
  selectCanAnimateInterface,
  selectChat,
  selectChatMessage,
  selectChatMessageOrEphemeral,
  selectEditingMessage,
  selectEphemeralMessage,
  selectForwardedSender,
  selectIsChatWithSelf,
  selectIsMessageProtected,
  selectSender,
  selectTabState,
} from '../../../global/selectors';
import { selectIsMediaNsfw } from '../../../global/selectors/media';
import { selectDraft, selectEditingId, selectEditingScheduledId } from '../../../global/selectors/threads';
import buildClassName from '../../../util/buildClassName';
import captureEscKeyListener from '../../../util/captureEscKeyListener';
import { unique } from '../../../util/iteratees';

import useAppLayout from '../../../hooks/useAppLayout';
import useContextMenuHandlers from '../../../hooks/useContextMenuHandlers';
import useCurrentOrPrev from '../../../hooks/useCurrentOrPrev';
import useFrozenProps from '../../../hooks/useFrozenProps';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import usePeerColor from '../../../hooks/usePeerColor';
import useShowTransitionDeprecated from '../../../hooks/useShowTransitionDeprecated';

import EmbeddedMessage from '../../common/embedded/EmbeddedMessage';
import Icon from '../../common/icons/Icon';
import Button from '../../ui/Button';
import Menu from '../../ui/Menu';
import MenuItem from '../../ui/MenuItem';
import MenuSeparator from '../../ui/MenuSeparator';

import './ComposerEmbeddedMessage.scss';

type StateProps = {
  replyInfo?: ApiInputDraftReplyInfo;
  editingId?: number;
  message?: ApiMessage;
  sender?: ApiPeer;
  shouldAnimate?: boolean;
  forwardedMessagesCount?: number;
  noAuthors?: boolean;
  noCaptions?: boolean;
  forwardsHaveCaptions?: boolean;
  isContextMenuDisabled?: boolean;
  isInChangingRecipientMode?: boolean;
  shouldPreventComposerAnimation?: boolean;
  senderChat?: ApiChat;
  currentUserId?: string;
  forwardMessageIds?: number[];
  fromChatId?: string;
  isMediaNsfw?: boolean;
  isMessageProtected?: boolean;
};

type OwnProps = {
  shouldForceShowEditing?: boolean;
  isHidden?: boolean;
  chatId: string;
  threadId: ThreadId;
  messageListType: MessageListType;
  onClear?: NoneToVoidFunction;
  onIsOpenChange?: (isOpen: boolean) => void;
};

const CLOSE_DURATION = 350;

const ComposerEmbeddedMessage = (props: OwnProps & StateProps) => {
  const {
    shouldAnimate,
    isMessageProtected,
    isInChangingRecipientMode,
    forwardMessageIds,
    fromChatId,
    replyInfo,
    editingId,
    isHidden,
    message,
    forwardedMessagesCount,
    onIsOpenChange,
  } = props;

  const {
    resetDraftReplyInfo,
    updateDraftReplyInfo,
    setEditingId,
    focusMessage,
    changeRecipient,
    openChatWithReplyInDraft,
    setForwardNoAuthors,
    setForwardNoCaptions,
    exitForwardMode,
    setShouldPreventComposerAnimation,
    requestMessageMediaEditor,
  } = getActions();
  const ref = useRef<HTMLDivElement>();

  const lang = useLang();
  const { isMobile } = useAppLayout();

  const isForwarding = Boolean(forwardedMessagesCount);

  const selectSenderFromForwardedMessage = useLastCallback((forwardedMessage: ApiMessage) => {
    const global = getGlobal();
    let localSender = selectForwardedSender(global, forwardedMessage);
    if (!localSender) {
      localSender = selectSender(global, forwardedMessage);
    }
    return localSender;
  });

  const forwardSenders = useMemo(() => {
    if (!isForwarding) return undefined;
    const forwardedMessages = forwardMessageIds
      ?.map((id) => selectChatMessageOrEphemeral(getGlobal(), fromChatId!, id))
      .filter(Boolean);
    const senders = forwardedMessages?.map((m) => selectSenderFromForwardedMessage(m)).filter(Boolean);
    return senders ? unique(senders) : undefined;
  }, [isForwarding, forwardMessageIds, fromChatId]);

  const isShown = (() => {
    if (isInChangingRecipientMode) return false;
    if (message && (replyInfo || editingId)) return true;
    if (replyInfo?.type === 'ephemeral') return true;
    if (forwardSenders && isForwarding) return true;
    return false;
  })();
  const isOpen = isShown && !isHidden;

  useEffect(() => {
    onIsOpenChange?.(isOpen);
    return () => onIsOpenChange?.(false);
  }, [isOpen, onIsOpenChange]);

  const {
    shouldRender, transitionClassNames, isClosing,
  } = useShowTransitionDeprecated(
    isOpen,
    undefined,
    !shouldAnimate,
    undefined,
    !shouldAnimate,
    CLOSE_DURATION,
    !shouldAnimate,
  );

  const {
    chatId,
    threadId,
    currentUserId,
    onClear,
    isContextMenuDisabled,
    shouldPreventComposerAnimation,
    sender,
    senderChat,
    isMediaNsfw,
    noAuthors,
    noCaptions,
    forwardsHaveCaptions,
    forwardedMessagesCount: frozenForwardedMessagesCount,
    message: frozenMessage,
    shouldForceShowEditing: frozenShouldForceShowEditing,
    replyInfo: frozenReplyInfo,
    editingId: frozenEditingId,
  } = useFrozenProps(props, isClosing);

  const isForwardingRendering = Boolean(frozenForwardedMessagesCount);
  const isShowingReplyRendering = Boolean(frozenReplyInfo) && !frozenShouldForceShowEditing;
  const isReplyWithQuoteRendering = frozenReplyInfo?.type === 'message'
    && Boolean(frozenReplyInfo.quoteText || frozenReplyInfo.quoteRich?.length);

  const canMediaBeEdited = frozenMessage && canEditMediaInEditor(frozenMessage) && !isMobile && !isMessageProtected;

  useEffect(() => {
    if (shouldPreventComposerAnimation) {
      setShouldPreventComposerAnimation({ shouldPreventComposerAnimation: false });
    }
  });

  const clearEmbedded = useLastCallback(() => {
    if (frozenEditingId) {
      setEditingId({ messageId: undefined });
    } else if (frozenForwardedMessagesCount) {
      exitForwardMode();
    } else if (frozenReplyInfo && !frozenShouldForceShowEditing) {
      resetDraftReplyInfo({ chatId, threadId });
    }
    onClear?.();
  });

  useEffect(() => (isShown && !isHidden ? captureEscKeyListener(clearEmbedded) : undefined), [
    isShown, isHidden, clearEmbedded,
  ]);

  const {
    isContextMenuOpen, contextMenuAnchor, handleContextMenu,
    handleContextMenuClose, handleContextMenuHide,
  } = useContextMenuHandlers(ref);

  const focusMessageFromDraft = () => {
    focusMessage({ chatId: frozenMessage!.chatId, messageId: frozenMessage!.id });
  };
  const handleMessageClick = useLastCallback((e: React.MouseEvent): void => {
    handleContextMenu(e);
  });

  const handlePictogramClick = useLastCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    if ((frozenEditingId || frozenReplyInfo?.type === 'message') && canMediaBeEdited) {
      requestMessageMediaEditor({ chatId: frozenMessage.chatId, messageId: frozenMessage.id });
      return;
    }
  });

  const handleClearClick = useLastCallback((e: React.MouseEvent<HTMLButtonElement, MouseEvent>): void => {
    e.stopPropagation();
    clearEmbedded();
    handleContextMenuHide();
  });
  const buildAutoCloseMenuItemHandler = (action: NoneToVoidFunction) => {
    return () => {
      handleContextMenuClose();
      action();
    };
  };
  const handleForwardToAnotherChatClick = useLastCallback(buildAutoCloseMenuItemHandler(changeRecipient));
  const handleShowMessageClick = useLastCallback(buildAutoCloseMenuItemHandler(focusMessageFromDraft));
  const handleRemoveQuoteClick = useLastCallback(buildAutoCloseMenuItemHandler(
    () => updateDraftReplyInfo({ quoteText: undefined, quoteRich: undefined, quoteOffset: undefined }),
  ));
  const handleChangeReplyRecipientClick = useLastCallback(buildAutoCloseMenuItemHandler(changeRecipient));
  const handleReplyInSenderChat = useLastCallback(() => {
    handleContextMenuClose();
    if (!sender) return;
    openChatWithReplyInDraft({ chatId: sender.id });
  });
  const handleDoNotReplyClick = useLastCallback(buildAutoCloseMenuItemHandler(clearEmbedded));

  const handleIconKeyDown = useLastCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleContextMenu(e as unknown as React.MouseEvent);
    }
  });

  const getTriggerElement = useLastCallback(() => ref.current);
  const getRootElement = useLastCallback(() => ref.current!);
  const getMenuElement = useLastCallback(() => ref.current!.querySelector('.forward-context-menu .bubble'));

  useEffect(() => {
    if (!shouldRender) {
      handleContextMenuClose();
      handleContextMenuHide();
    }
  }, [handleContextMenuClose, handleContextMenuHide, shouldRender]);

  const className = buildClassName('ComposerEmbeddedMessage', transitionClassNames);

  const { className: peerColorClass, style: peerColorStyle } = usePeerColor({
    peer: sender,
  });
  const innerClassName = buildClassName('ComposerEmbeddedMessage_inner', peerColorClass);

  const leftIcon = useMemo(() => {
    if (frozenEditingId) {
      return 'edit';
    }
    if (isForwardingRendering) {
      return 'forward';
    }
    if (isShowingReplyRendering) {
      return 'reply';
    }

    return undefined;
  }, [frozenEditingId, isForwardingRendering, isShowingReplyRendering]);

  const customText = !frozenMessage && frozenReplyInfo?.type === 'ephemeral'
    ? lang('EphemeralReplyUnavailable')
    : frozenForwardedMessagesCount && frozenForwardedMessagesCount > 1
      ? lang('PreviewForwardedMessage', { count: frozenForwardedMessagesCount }, {
        pluralValue: frozenForwardedMessagesCount,
      })
      : undefined;

  const renderingLeftIcon = useCurrentOrPrev(leftIcon, true);

  if (!shouldRender) {
    return undefined;
  }

  const canReplyInSenderChat = sender && chatId !== sender.id && sender.id !== currentUserId;

  return (
    <div className={className} ref={ref} onContextMenu={handleContextMenu}>
      <div className={innerClassName} style={peerColorStyle}>
        <div
          className="embedded-left-icon"
          role="button"
          tabIndex={0}
          onClick={handleContextMenu}
          onKeyDown={handleIconKeyDown}
        >
          {renderingLeftIcon && <Icon name={renderingLeftIcon} />}
          {isReplyWithQuoteRendering && (
            <Icon name="quote" className="quote-reply" />
          )}
        </div>
        <EmbeddedMessage
          isOpen={isShown}
          className="inside-input"
          replyInfo={frozenReplyInfo}
          isMediaNsfw={isMediaNsfw}
          isInComposer
          message={frozenMessage}
          sender={!noAuthors ? sender : undefined}
          composerForwardSenders={forwardSenders}
          customText={customText}
          noCaptions={noCaptions}
          title={(frozenEditingId && !isShowingReplyRendering) ? lang('PreviewEditMessage')
            : noAuthors ? lang('HiddenSendersNameDescription') : undefined}
          onClick={handleMessageClick}
          onPictogramClick={canMediaBeEdited ? handlePictogramClick : undefined}
          pictogramActionIcon={canMediaBeEdited ? 'edit' : undefined}
          senderChat={senderChat}
        />
        <Button
          className="embedded-cancel"
          round
          faded
          color="translucent"
          ariaLabel={lang('Cancel')}
          onClick={handleClearClick}
          iconName="close"
        />
        {(isShowingReplyRendering || isForwardingRendering) && !isContextMenuDisabled && (
          <Menu
            isOpen={isContextMenuOpen}
            anchor={contextMenuAnchor}
            getTriggerElement={getTriggerElement}
            getRootElement={getRootElement}
            getMenuElement={getMenuElement}
            className="forward-context-menu"
            onClose={handleContextMenuClose}
            onCloseAnimationEnd={handleContextMenuHide}
          >
            {isForwardingRendering && (
              <>
                <MenuItem
                  icon={!noAuthors ? 'check' : undefined}
                  customIcon={noAuthors ? <Icon name="placeholder" /> : undefined}

                  onClick={() => setForwardNoAuthors({
                    noAuthors: false,
                  })}
                >
                  {lang(frozenForwardedMessagesCount > 1 ? 'ShowSenderNames' : 'ShowSendersName')}
                </MenuItem>
                <MenuItem
                  icon={noAuthors ? 'check' : undefined}
                  customIcon={!noAuthors ? <Icon name="placeholder" /> : undefined}

                  onClick={() => setForwardNoAuthors({
                    noAuthors: true,
                  })}
                >
                  {lang(frozenForwardedMessagesCount > 1 ? 'HideSenderNames' : 'HideSendersName')}
                </MenuItem>
                {forwardsHaveCaptions && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      icon={!noCaptions ? 'check' : undefined}
                      customIcon={noCaptions ? <Icon name="placeholder" /> : undefined}

                      onClick={() => setForwardNoCaptions({
                        noCaptions: false,
                      })}
                    >
                      {lang(frozenForwardedMessagesCount > 1 ? 'ConversationForwardOptionsShowCaption' : 'ShowCaption')}
                    </MenuItem>
                    <MenuItem
                      icon={noCaptions ? 'check' : undefined}
                      customIcon={!noCaptions ? <Icon name="placeholder" /> : undefined}

                      onClick={() => setForwardNoCaptions({
                        noCaptions: true,
                      })}
                    >
                      {lang(frozenForwardedMessagesCount > 1 ? 'ConversationForwardOptionsHideCaption' : 'HideCaption')}
                    </MenuItem>
                  </>
                )}
                <MenuSeparator />
                <MenuItem icon="replace" onClick={handleForwardToAnotherChatClick}>
                  {lang('ForwardToAnotherChat')}
                </MenuItem>
              </>
            )}
            {isShowingReplyRendering && (
              <>
                <MenuItem
                  icon="show-message"
                  onClick={handleShowMessageClick}
                >
                  {lang('AudioShowInChat')}
                </MenuItem>
                {isReplyWithQuoteRendering && (
                  <MenuItem
                    icon="remove-quote"
                    onClick={handleRemoveQuoteClick}
                  >
                    {lang('RemoveQuote')}
                  </MenuItem>
                )}
                {canReplyInSenderChat && (
                  <MenuItem icon="user" onClick={handleReplyInSenderChat}>
                    {lang('ReplyInPrivateMessage')}
                  </MenuItem>
                )}
                <MenuItem icon="replace" onClick={handleChangeReplyRecipientClick}>
                  {lang('ReplyToAnotherChat')}
                </MenuItem>
                <MenuItem icon="delete" onClick={handleDoNotReplyClick}>
                  {lang('DoNotReply')}
                </MenuItem>
              </>
            )}
          </Menu>
        )}
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, {
    shouldForceShowEditing, chatId, threadId, messageListType,
  }): Complete<StateProps> => {
    const {
      forwardMessages: {
        fromChatId, toChatId, messageIds: forwardMessageIds, noAuthors, noCaptions,
      },
      isShareMessageModalShown: isModalShown,
      shouldPreventComposerAnimation,
    } = selectTabState(global);

    const editingId = messageListType === 'scheduled'
      ? selectEditingScheduledId(global, chatId)
      : selectEditingId(global, chatId, threadId);
    const shouldAnimate = selectCanAnimateInterface(global) && !shouldPreventComposerAnimation;
    const isForwarding = toChatId === chatId;
    const forwardedMessages = forwardMessageIds
      ?.map((id) => selectChatMessageOrEphemeral(global, fromChatId!, id))
      .filter(Boolean);

    const draft = selectDraft(global, chatId, threadId);
    const replyInfo = draft?.replyInfo;
    const replyToPeerId = replyInfo?.type === 'message' ? replyInfo.replyToPeerId : undefined;
    const senderChat = replyToPeerId ? selectChat(global, replyToPeerId) : undefined;

    let message: ApiMessage | undefined;
    if (editingId) {
      message = selectEditingMessage(global, chatId, threadId, messageListType);
    } else if (isForwarding && forwardMessageIds!.length === 1) {
      message = forwardedMessages?.[0];
    } else if (replyInfo && !shouldForceShowEditing) {
      message = replyInfo.type === 'ephemeral'
        ? selectEphemeralMessage(global, chatId, replyInfo.replyToMsgId)
        : selectChatMessage(global, replyInfo.replyToPeerId || chatId, replyInfo.replyToMsgId);
    }

    let sender: ApiPeer | undefined;

    const selectSenderFromForwardedMessage = (forwardedMessage: ApiMessage) => {
      sender = selectForwardedSender(global, forwardedMessage);
      if (!sender) {
        sender = selectSender(global, forwardedMessage);
      }
      return sender;
    };

    if (editingId && message) {
      sender = selectSender(global, message);
    } else if (isForwarding) {
      let forwardSenders = forwardedMessages?.map((m) => selectSenderFromForwardedMessage(m)).filter(Boolean);
      forwardSenders = forwardSenders ? unique(forwardSenders) : undefined;
      sender = forwardSenders?.length === 1 ? forwardSenders?.[0] : undefined;
    } else if (replyInfo && message && !shouldForceShowEditing) {
      const { forwardInfo } = message;
      const isChatWithSelf = selectIsChatWithSelf(global, chatId);
      if (forwardInfo && (forwardInfo.isChannelPost || isChatWithSelf)) {
        sender = selectForwardedSender(global, message);
      }

      const hasQuote = replyInfo.type === 'message' && Boolean(replyInfo.quoteText || replyInfo.quoteRich?.length);
      if (!sender && (!forwardInfo?.hiddenUserName || hasQuote)) {
        sender = selectSender(global, message);
      }
    }

    const forwardsHaveCaptions = forwardedMessages?.some((forward) => (
      forward?.content.text && Object.keys(forward.content).length > 1
    ));

    const isContextMenuDisabled = replyInfo?.type === 'ephemeral'
      || (isForwarding && forwardMessageIds!.length === 1 && Boolean(message?.content.storyData));

    const isMediaNsfw = message && selectIsMediaNsfw(global, message);

    return {
      replyInfo,
      editingId,
      message,
      sender,
      shouldAnimate,
      forwardedMessagesCount: isForwarding ? forwardMessageIds!.length : undefined,
      noAuthors,
      noCaptions,
      forwardsHaveCaptions,
      isContextMenuDisabled,
      isInChangingRecipientMode: isModalShown,
      shouldPreventComposerAnimation,
      senderChat,
      currentUserId: global.currentUserId,
      forwardMessageIds,
      fromChatId,
      isMediaNsfw,
      isMessageProtected: !editingId && selectIsMessageProtected(global, message),
    };
  },
)(ComposerEmbeddedMessage));
