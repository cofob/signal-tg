import { getActions, withGlobal } from '../../../global';

import type { ApiContact, ApiCountryCode, ApiUser } from '../../../api/types';

import { getCanAddContact, getUserFullName } from '../../../global/helpers';
import { selectUser } from '../../../global/selectors';
import { copyTextToClipboard } from '../../../util/clipboard';
import download from '../../../util/download';
import { formatPhoneNumberWithCode } from '../../../util/phoneNumber';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Avatar from '../../common/Avatar';
import PeerColorWrapper from '../../common/PeerColorWrapper';
import Button from '../../ui/Button';

import styles from './Contact.module.scss';

type OwnProps = {
  contact: ApiContact;
  noUserColors?: boolean;
};

type StateProps = {
  user?: ApiUser;
  phoneCodeList: ApiCountryCode[];
};

const UNREGISTERED_CONTACT_ID = '0';
const VCARD_MIME_TYPE = 'text/vcard';
// The download starts after a short delay, see `download`
const VCARD_URL_LIFETIME_MS = 60 * 1000;

const Contact = ({
  contact, user, phoneCodeList, noUserColors,
}: OwnProps & StateProps) => {
  const {
    openChat, openAddContactDialog, showNotification, openChatWithInfo,
  } = getActions();
  const lang = useLang();

  const { phoneNumber, userId, vcard } = contact;
  const isRegistered = userId !== UNREGISTERED_CONTACT_ID;
  // Signal has no contact list on the server: a shared contact is saved as a vCard instead
  const canAddContact = Boolean(vcard) || (isRegistered && user && getCanAddContact(user));

  const handleOpenChat = useLastCallback(() => {
    openChat({ id: userId });
  });

  const handleAddContact = useLastCallback(() => {
    if (!vcard) {
      openAddContactDialog({ userId: user?.id });
      return;
    }

    const url = URL.createObjectURL(new Blob([vcard], { type: VCARD_MIME_TYPE }));
    download(url, `${getContactName(contact) || phoneNumber}.vcf`);
    setTimeout(() => URL.revokeObjectURL(url), VCARD_URL_LIFETIME_MS);
  });

  const handleClick = useLastCallback(() => {
    if (user) {
      openChatWithInfo({ id: userId });
    } else {
      copyTextToClipboard(phoneNumber);
      showNotification({
        message: {
          key: 'PhoneCopied',
          options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
        },
      });
    }
  });

  return (
    <PeerColorWrapper
      noUserColors={noUserColors}
      peer={user}
      emojiIconClassName={styles.emojiIconBackground}
      className={styles.root}
    >
      <div className={styles.infoContainer} onClick={handleClick}>
        <Avatar size="medium" peer={user} text={getContactName(contact)} />
        <div className={styles.info}>
          <div className={styles.name}>
            {user ? getUserFullName(lang, user) : getContactName(contact)}
          </div>
          <div className={styles.phone}>
            {formatPhoneNumberWithCode(phoneCodeList, phoneNumber)}
          </div>
        </div>
      </div>
      {(isRegistered || canAddContact) && (
        <>
          <div className={styles.divider} />
          <div className={styles.buttons}>
            {isRegistered && (
              <Button
                isText
                color="translucent"
                ripple
                size="tiny"
                onClick={handleOpenChat}
                className={styles.button}
              >
                {lang('Message')}
              </Button>
            )}
            {canAddContact && (
              <Button
                isText
                color="translucent"
                ripple
                size="tiny"
                onClick={handleAddContact}
                className={styles.button}
              >
                {lang('Add')}
              </Button>
            )}
          </div>
        </>
      )}
    </PeerColorWrapper>
  );
};

function getContactName(contact: ApiContact) {
  if (contact.firstName && contact.lastName) {
    return `${contact.firstName} ${contact.lastName}`;
  }

  if (contact.firstName) {
    return contact.firstName;
  }

  if (contact.lastName) {
    return contact.lastName;
  }

  return '';
}

export default withGlobal<OwnProps>((global, { contact }): Complete<StateProps> => {
  const {
    countryList: { phoneCodes: phoneCodeList },
  } = global;
  const user = selectUser(global, contact.userId);

  return {
    user,
    phoneCodeList,
  };
})(Contact);
