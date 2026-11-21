import {
  memo,
  useEffect,
  useMemo, useState,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiChat } from '../../../api/types';
import type { TabState } from '../../../global/types';

import { getHasAdminRight } from '../../../global/helpers';
import { selectChat } from '../../../global/selectors';
import { MEMO_EMPTY_ARRAY } from '../../../util/memo';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import PeerPicker from '../../common/pickers/PeerPicker';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';

import styles from './InviteViaLinkModal.module.scss';

export type OwnProps = {
  modal: TabState['inviteViaLinkModal'];
};

type StateProps = {
  chat?: ApiChat;
};

const InviteViaLinkModal = ({
  modal,
  chat,
}: OwnProps & StateProps) => {
  const { sendInviteMessages, closeInviteViaLinkModal } = getActions();
  const { missingUsers } = modal || {};

  const lang = useLang();
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const userIds = useMemo(() => missingUsers?.map((user) => user.id) || MEMO_EMPTY_ARRAY, [missingUsers]);
  useEffect(() => {
    setSelectedMemberIds(userIds);
  }, [userIds]);

  const handleClose = useLastCallback(() => closeInviteViaLinkModal());

  const handleSendInviteLink = useLastCallback(() => {
    sendInviteMessages({ chatId: chat!.id, userIds: selectedMemberIds });
    closeInviteViaLinkModal();
  });

  const canSendInviteLink = useMemo(() => {
    if (!chat) return undefined;
    return getHasAdminRight(chat, 'inviteUsers');
  }, [chat]);

  const inviteSectionText = useMemo(() => {
    return canSendInviteLink
      ? lang(missingUsers?.length === 1 ? 'InviteBlockedOneMessage' : 'InviteBlockedManyMessage')
      : lang('InviteRestrictedUsers', { count: missingUsers?.length }, {
        pluralValue: missingUsers?.length || 0,
        withMarkdown: true,
        withNodes: true,
      });
  }, [canSendInviteLink, lang, missingUsers?.length]);

  const hasSelectableSection = Boolean(userIds.length);

  return (
    <Modal
      isOpen={Boolean(userIds && chat)}
      contentClassName={styles.content}
      hasAbsoluteCloseButton
      onClose={handleClose}
      isSlim
    >
      {hasSelectableSection && (
        <>
          <h3 className={styles.title}>{lang('InviteBlockedTitle')}</h3>
          <p className={styles.contentText}>
            {inviteSectionText}
          </p>
          <PeerPicker
            className={styles.userPicker}
            itemIds={userIds}
            selectedIds={selectedMemberIds}
            onSelectedIdsChange={setSelectedMemberIds}
            isViewOnly={!canSendInviteLink}
            allowMultiple
            withStatus
            itemInputType="checkbox"
          />
          {canSendInviteLink && (
            <Button
              className={styles.sendInvites}
              onClick={handleSendInviteLink}
              disabled={!selectedMemberIds.length}
            >
              {lang('InviteViaLinkButton')}
            </Button>
          )}
        </>
      )}
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { modal }): Complete<StateProps> => {
    const chat = modal?.chatId ? selectChat(global, modal.chatId) : undefined;

    return {
      chat,
    };
  },
)(InviteViaLinkModal));
