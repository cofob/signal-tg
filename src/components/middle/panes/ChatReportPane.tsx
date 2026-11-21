import { memo, useEffect, useState } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiPeer } from '../../../api/types';

import {
  getChatTitle, getUserFirstOrLastName, getUserFullName, isChatBasicGroup,
} from '../../../global/helpers';
import { isApiPeerChat, isApiPeerUser } from '../../../global/helpers/peers';
import { selectPeer } from '../../../global/selectors';
import buildClassName from '../../../util/buildClassName';

import useFlag from '../../../hooks/useFlag';
import useFrozenProps from '../../../hooks/useFrozenProps';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import useHeaderPane, { type PaneState } from '../hooks/useHeaderPane';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';
import ConfirmDialog from '../../ui/ConfirmDialog';

import './ChatReportPane.scss';

type OwnProps = {
  chatId: string;
  className?: string;
  isAutoArchived?: boolean;
  isMessageRequest?: boolean;
  canReportSpam?: boolean;
  canAddContact?: boolean;
  canBlockContact?: boolean;
  onPaneStateChange?: (state: PaneState) => void;
};

type StateProps = {
  currentUserId?: string;
  peer?: ApiPeer;
};

type MessageRequestDialog = 'block' | 'delete' | 'report';

const ChatReportPane = ({
  chatId,
  className,
  isAutoArchived,
  isMessageRequest,
  canReportSpam,
  canAddContact,
  canBlockContact,
  peer,
  currentUserId,
  onPaneStateChange,
}: OwnProps & StateProps) => {
  const {
    openAddContactDialog,
    blockUser,
    reportSpam,
    leaveChannel,
    deleteChatUser,
    deleteHistory,
    toggleChatArchived,
    hidePeerSettingsBar,
  } = getActions();

  const lang = useLang();
  const [isBlockUserModalOpen, openBlockUserModal, closeBlockUserModal] = useFlag();
  const [shouldReportSpam, setShouldReportSpam] = useState<boolean>(true);
  const [shouldDeleteChat, setShouldDeleteChat] = useState<boolean>(true);
  const [requestDialog, setRequestDialog] = useState<MessageRequestDialog | undefined>();
  const [shouldBlockReported, setShouldBlockReported] = useState<boolean>(true);

  const hasAnyButton = isMessageRequest || canAddContact || canBlockContact || canReportSpam;
  const isRendering = Boolean(hasAnyButton && peer);

  const {
    chatId: renderingChatId,
    peer: renderingPeer,
    canAddContact: renderingCanAddContact,
    canBlockContact: renderingCanBlockContact,
    canReportSpam: renderingCanReportSpam,
    isAutoArchived: renderingIsAutoArchived,
    isMessageRequest: renderingIsMessageRequest,
  } = useFrozenProps({
    chatId, peer, canAddContact, canBlockContact, canReportSpam, isAutoArchived, isMessageRequest,
  }, !isRendering);
  const chat = renderingPeer && isApiPeerChat(renderingPeer) ? renderingPeer : undefined;
  const user = renderingPeer && isApiPeerUser(renderingPeer) ? renderingPeer : undefined;
  const isBasicGroup = chat && isChatBasicGroup(chat);

  const handleAddContact = useLastCallback(() => {
    openAddContactDialog({ userId: renderingChatId });
    if (renderingIsAutoArchived) {
      toggleChatArchived({ id: renderingChatId });
    }
  });

  const handleConfirmBlock = useLastCallback(() => {
    closeBlockUserModal();
    blockUser({ userId: renderingChatId });
    if (renderingCanReportSpam && shouldReportSpam) {
      reportSpam({ chatId: renderingChatId });
    }
    if (shouldDeleteChat) {
      deleteHistory({ chatId: renderingChatId, shouldDeleteForAll: false });
    }
  });

  const handleCloseReportPane = useLastCallback(() => {
    hidePeerSettingsBar({ peerId: renderingChatId });
  });

  const handleChatReportSpam = useLastCallback(() => {
    closeBlockUserModal();
    reportSpam({ chatId: renderingChatId });
    if (isBasicGroup) {
      deleteChatUser({ chatId: renderingChatId, userId: currentUserId! });
      deleteHistory({ chatId: renderingChatId, shouldDeleteForAll: false });
    } else {
      leaveChannel({ chatId: renderingChatId });
    }
  });

  const handleAcceptRequest = useLastCallback(() => {
    hidePeerSettingsBar({ peerId: renderingChatId });
  });

  const handleDeleteRequestClick = useLastCallback(() => setRequestDialog('delete'));
  const handleBlockRequestClick = useLastCallback(() => setRequestDialog('block'));
  const handleReportRequestClick = useLastCallback(() => setRequestDialog('report'));

  const handleCloseRequestDialog = useLastCallback(() => {
    setRequestDialog(undefined);
  });

  const handleConfirmRequestDialog = useLastCallback(() => {
    setRequestDialog(undefined);
    if (requestDialog === 'block') {
      blockUser({ userId: renderingChatId });
    } else if (requestDialog === 'delete') {
      deleteHistory({ chatId: renderingChatId, shouldDeleteForAll: false });
    } else {
      // The report goes first: it names messages of the request
      reportSpam({ chatId: renderingChatId });
      if (shouldBlockReported) blockUser({ userId: renderingChatId });
    }
  });

  useEffect(() => {
    closeBlockUserModal();
    setShouldReportSpam(true);
    setShouldDeleteChat(true);
    setRequestDialog(undefined);
    setShouldBlockReported(true);
  }, [chatId, isRendering, closeBlockUserModal]);

  const { ref, shouldRender } = useHeaderPane({
    isOpen: isRendering,
    measureKey: chatId,
    onStateChange: onPaneStateChange,
  });

  if (!shouldRender) return undefined;

  if (renderingIsMessageRequest) {
    return (
      <div
        ref={ref}
        className={buildClassName('ChatReportPane', className)}
        dir={lang.isRtl ? 'rtl' : undefined}
      >
        <Button isText fluid size="tiny" className="ChatReportPane--Button" onClick={handleAcceptRequest}>
          {lang('MessageRequestAccept')}
        </Button>
        <Button
          color="danger"
          isText
          fluid
          size="tiny"
          className="ChatReportPane--Button"
          onClick={handleDeleteRequestClick}
        >
          {lang('MessageRequestDelete')}
        </Button>
        <Button
          color="danger"
          isText
          fluid
          size="tiny"
          className="ChatReportPane--Button"
          onClick={handleBlockRequestClick}
        >
          {lang('MessageRequestBlock')}
        </Button>
        {user && (
          <Button
            color="danger"
            isText
            fluid
            size="tiny"
            className="ChatReportPane--Button"
            onClick={handleReportRequestClick}
          >
            {lang('MessageRequestReport')}
          </Button>
        )}
        <ConfirmDialog
          isOpen={Boolean(requestDialog)}
          onClose={handleCloseRequestDialog}
          title={requestDialog === 'block'
            ? lang('MessageRequestBlockTitle', {
              title: user ? getUserFirstOrLastName(lang, user) : getChatTitle(lang, chat!),
            })
            : lang(requestDialog === 'delete' ? 'MessageRequestDeleteTitle' : 'MessageRequestReportTitle')}
          text={requestDialog === 'block'
            ? lang(user ? 'MessageRequestBlockText' : 'MessageRequestBlockGroupText')
            : lang(requestDialog === 'delete' ? 'MessageRequestDeleteText' : 'MessageRequestReportText')}
          confirmIsDestructive
          confirmLabel={lang(requestDialog === 'block' ? 'MessageRequestBlock'
            : requestDialog === 'delete' ? 'MessageRequestDelete' : 'MessageRequestReport')}
          confirmHandler={handleConfirmRequestDialog}
        >
          {requestDialog === 'report' && (
            <Checkbox
              className="dialog-checkbox"
              label={lang('MessageRequestReportAndBlock')}
              checked={shouldBlockReported}
              onCheck={setShouldBlockReported}
            />
          )}
        </ConfirmDialog>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={buildClassName('ChatReportPane', className)}
      dir={lang.isRtl ? 'rtl' : undefined}
    >
      {renderingCanAddContact && (
        <Button
          isText
          fluid
          size="tiny"
          className="ChatReportPane--Button"
          onClick={handleAddContact}
        >
          {lang('NewContactAdd')}
        </Button>
      )}
      {renderingCanBlockContact && (
        <Button
          color="danger"
          isText
          fluid
          size="tiny"
          className="ChatReportPane--Button"
          onClick={openBlockUserModal}
        >
          {lang('NewContactBlock')}
        </Button>
      )}
      {renderingCanReportSpam && !renderingCanBlockContact && (
        <Button
          color="danger"
          isText
          fluid
          size="tiny"
          className="ChatReportPane--Button"
          onClick={openBlockUserModal}
        >
          {lang('ReportSpamAndLeave')}
        </Button>
      )}
      <Button
        round
        ripple
        size="smaller"
        color="translucent"
        onClick={handleCloseReportPane}
        ariaLabel={lang('Close')}
        iconName="close"
      />
      <ConfirmDialog
        isOpen={isBlockUserModalOpen}
        onClose={closeBlockUserModal}
        title={lang('BlockUserTitle', { user: user ? getUserFirstOrLastName(lang, user) : getChatTitle(lang, chat!) })}
        text={user
          ? lang('UserInfoBlockConfirmationTitle', { user: getUserFullName(lang, user) })
          : lang('ChatConfirmReportSpamChannel')}
        confirmIsDestructive
        confirmLabel={lang('Block')}
        confirmHandler={user ? handleConfirmBlock : handleChatReportSpam}
      >
        {user && (
          <Checkbox
            className="dialog-checkbox"
            label={lang('DeleteThisChat')}
            checked={shouldDeleteChat}
            onCheck={setShouldDeleteChat}
          />
        )}
        {user && renderingCanReportSpam && (
          <Checkbox
            className="ChatReportPane--Checkbox dialog-checkbox"
            label={lang('ReportPeerReport')}
            checked={shouldReportSpam}
            onCheck={setShouldReportSpam}
          />
        )}
      </ConfirmDialog>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => ({
    currentUserId: global.currentUserId,
    peer: selectPeer(global, chatId),
  }),
)(ChatReportPane));
