import {
  memo,
  useEffect,
  useMemo,
} from '../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../global';

import type {
  ApiChat, ApiCountryCode, ApiUserCommonChats, ApiUserFullInfo,
} from '../../api/types';

import { getChatTitle } from '../../global/helpers';
import {
  selectChat, selectPeer, selectUserCommonChats, selectUserFullInfo,
} from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import { isoToEmoji } from '../../util/emoji/emoji';
import { formatRegistrationMonth, formatRelativeAge, secondsToDate } from '../../util/localization/dateFormat';
import { getCountryCodeByIso } from '../../util/phoneNumber';
import stopEvent from '../../util/stopEvent';
import renderText from '../common/helpers/renderText';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import AvatarList from '../common/AvatarList';
import Icon from '../common/icons/Icon';
import MiniTable, { type TableEntry } from '../common/MiniTable';
import Link from '../ui/Link';

import styles from './MessageListAccountInfo.module.scss';

type OwnProps = {
  chatId: string;
};

type StateProps = {
  chat?: ApiChat;
  phoneCodeList?: ApiCountryCode[];
  commonChats?: ApiUserCommonChats;
  userFullInfo?: ApiUserFullInfo;
};

const MessageListAccountInfo = ({
  chat,
  chatId,
  phoneCodeList,
  commonChats,
  userFullInfo,
}: OwnProps & StateProps) => {
  const { loadCommonChats, openChatWithInfo } = getActions();

  const lang = useLang();

  const {
    phoneCountry,
    registrationMonth,
    nameChangeDate,
    photoChangeDate,
  } = userFullInfo?.settings || {};

  useEffect(() => {
    loadCommonChats({ userId: chatId });
  }, [chatId]);

  const country = useMemo(() => {
    if (!phoneCodeList || !phoneCountry) return undefined;
    return getCountryCodeByIso(phoneCodeList, phoneCountry);
  }, [phoneCodeList, phoneCountry]);

  const isChatInfoEmpty = !country || !registrationMonth;

  const handleClick = useLastCallback((e: React.SyntheticEvent<any>) => {
    stopEvent(e);
    openChatWithInfo({
      id: chatId, shouldReplaceHistory: true, profileTab: 'commonChats', forceScrollProfileTab: true,
    });
  });

  const securityNameInfo = nameChangeDate && chat ? (
    <div className="local-action-message" key="security-name-message">
      <span>
        {lang('UserUpdatedName', {
          user: chat.title,
          time: formatRelativeAge(lang, secondsToDate(nameChangeDate)),
        }, { withNodes: true, withMarkdown: true })}
      </span>
    </div>
  ) : undefined;

  const securityPhotoInfo = photoChangeDate && chat ? (
    <div className="local-action-message" key="security-photo-message">
      <span>
        {lang('UserUpdatedPhoto', {
          user: chat.title,
          time: formatRelativeAge(lang, secondsToDate(photoChangeDate)),
        }, { withNodes: true, withMarkdown: true })}
      </span>
    </div>
  ) : undefined;

  const tableData = useMemo((): TableEntry[] => {
    const entries: TableEntry[] = [];
    if (country) {
      entries.push([
        lang('PrivacyPhone'),
        <span className={styles.chatDescription}>
          <span className={styles.country}>
            {renderText(isoToEmoji(country?.iso2))}
          </span>
          {lang.region(country.iso2) || country.defaultName}
        </span>,
      ]);
    }
    if (registrationMonth) {
      entries.push([
        lang('ContactInfoRegistration'),
        formatRegistrationMonth(lang, registrationMonth),
      ]);
    }
    if (userFullInfo?.commonChatsCount) {
      const global = getGlobal();
      const peers = commonChats?.ids.slice(0, 3).map((id) => selectPeer(global, id)!).filter(Boolean);
      entries.push([
        lang('ChatNonContactUserGroups'),
        <Link className={styles.link} onClick={handleClick}>
          <span className={styles.linkInfo}>
            {lang('ChatGroups', {
              count: userFullInfo.commonChatsCount,
            }, {
              pluralValue: userFullInfo.commonChatsCount,
            })}
          </span>
          {Boolean(peers?.length) && <AvatarList size="micro" peers={peers} />}
          <Icon name="next" className={styles.icon} />
        </Link>,
      ]);
    }
    return entries;
  }, [lang, country, registrationMonth, commonChats, userFullInfo]);

  return (
    <div className={buildClassName(styles.root, 'empty')}>
      {!isChatInfoEmpty && chat && (
        <div
          className={buildClassName(styles.chatInfo, styles.chatBackground)}
        >
          <h3 className={styles.chatInfoTitle}>{renderText(getChatTitle(lang, chat))}</h3>
          <p className={buildClassName(styles.chatInfoSubtitle, styles.textColor)}>
            {lang('ChatNonContactUserSubtitle')}
          </p>
          <MiniTable keyClassName={styles.textColor} data={tableData} />
        </div>
      )}
      {securityNameInfo}
      {securityPhotoInfo}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const {
      countryList: { phoneCodes: phoneCodeList },
    } = global;
    const chat = selectChat(global, chatId);
    const userFullInfo = selectUserFullInfo(global, chatId);
    const commonChats = selectUserCommonChats(global, chatId);
    return {
      chat,
      userFullInfo,
      phoneCodeList,
      commonChats,
    };
  },
)(MessageListAccountInfo));
