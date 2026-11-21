import { memo } from '../../lib/teact/teact';

import type { MessageListType } from '../../types';
import type { LangFn } from '../../util/localization';

import useLang from '../../hooks/useLang';

import Icon from '../common/icons/Icon';

import './NoMessages.scss';

const GROUP_MEMBERS_LIMIT = 200000;

type OwnProps = {
  chatId: string;
  isChatWithSelf?: boolean;
  type: MessageListType;
  isGroupChatJustCreated?: boolean;
};

const NoMessages = ({
  isChatWithSelf,
  type,
  isGroupChatJustCreated,
}: OwnProps) => {
  const lang = useLang();

  if (type === 'scheduled') {
    return renderScheduled(lang);
  }

  if (isChatWithSelf) {
    return renderSavedMessages(lang);
  }

  if (isGroupChatJustCreated) {
    return renderGroup(lang);
  }

  return (
    <div className="empty"><span>{lang('NoMessages')}</span></div>
  );
};

function renderScheduled(lang: LangFn) {
  return (
    <div className="empty"><span>{lang('ScheduledMessagesEmptyPlaceholder')}</span></div>
  );
}

function renderSavedMessages(lang: LangFn) {
  return (
    <div className="NoMessages">
      <div className="wrapper">
        <Icon name="cloud-download" className="no-messages-icon" />
        <h3 className="title">{lang('ConversationCloudStorageInfoTitle')}</h3>
        <ul className="description">
          <li>{lang('ConversationClousStorageInfoDescription1')}</li>
          <li>{lang('ConversationClousStorageInfoDescription2')}</li>
          <li>{lang('ConversationClousStorageInfoDescription3')}</li>
          <li>{lang('ConversationClousStorageInfoDescription4')}</li>
        </ul>
      </div>
    </div>
  );
}

function renderGroup(lang: LangFn) {
  return (
    <div className="NoMessages">
      <div className="wrapper" dir={lang.isRtl ? 'rtl' : undefined}>
        <h3 className="title">{lang('EmptyGroupInfoTitle')}</h3>
        <p className="description">{lang('EmptyGroupInfoSubtitle')}</p>
        <ul className="list-checkmarks">
          <li>{lang('EmptyGroupInfoLine1', { count: GROUP_MEMBERS_LIMIT })}</li>
          <li>{lang('EmptyGroupInfoLine2')}</li>
          <li>{lang('EmptyGroupInfoLine3')}</li>
          <li>{lang('EmptyGroupInfoLine4')}</li>
        </ul>
      </div>
    </div>
  );
}

export default memo(NoMessages);
