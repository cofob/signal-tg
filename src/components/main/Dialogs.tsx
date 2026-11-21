import type { TeactNode } from '../../lib/teact/teact';
import { memo, useEffect } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type {
  ApiDialog,
  ApiDialogError,
  ApiDialogLocalizedMessage,
  ApiDialogMessage,
} from '../../api/types';
import type { LangFn } from '../../util/localization';

import { APP_NAME } from '../../config';
import { selectTabState } from '../../global/selectors';
import getReadableErrorText from '../../util/getReadableErrorText';
import { renderTextWithEntities } from '../common/helpers/renderTextWithEntities';

import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Modal from '../ui/Modal';

type StateProps = {
  dialogs: ApiDialog[];
};

const Dialogs = ({ dialogs }: StateProps) => {
  const { dismissDialog, signOut } = getActions();
  const [isModalOpen, openModal, closeModal] = useFlag();

  const lang = useLang();

  const handleEraseStorage = useLastCallback(() => {
    closeModal();
    signOut({ forceInitApi: true });
  });

  useEffect(() => {
    if (dialogs.length > 0) {
      openModal();
    }
  }, [dialogs, openModal]);

  if (!dialogs.length) {
    return undefined;
  }

  const renderTextDialog = (renderedText: TeactNode, title = APP_NAME) => {
    return (
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        onCloseAnimationEnd={dismissDialog}
        className="error"
        title={title}
        isNativeDialog
      >
        {renderedText}
        <div className="dialog-buttons mt-2">
          <Button isText onClick={closeModal}>{lang('OK')}</Button>
        </div>
      </Modal>
    );
  };

  const renderFormattedTextDialog = (dialog: ApiDialogMessage) => {
    const renderedText = renderTextWithEntities(dialog.text);

    return renderTextDialog(renderedText, dialog.title);
  };

  const renderLocalizedDialog = (dialog: ApiDialogLocalizedMessage) => {
    return renderTextDialog(lang.with(dialog.text), dialog.title && lang.withRegular(dialog.title));
  };

  const renderError = (error: ApiDialogError) => {
    const renderedErrorMessage = error.hasErrorKey
      ? getReadableErrorText(lang, error)
      : error.entities?.length
        ? renderTextWithEntities({ text: error.message, entities: error.entities })
        : error.message;

    return renderTextDialog(renderedErrorMessage, getErrorHeader(lang, error));
  };

  // Erasing is the only way on when the stored data cannot be opened: the logout removes this account's data, and the
  // link screen follows
  const renderStorageLockedDialog = () => {
    return (
      <ConfirmDialog
        isOpen={isModalOpen}
        title={lang('SignalStorageLockedTitle')}
        text={lang('SignalStorageLocked')}
        confirmLabel={lang('SignalStorageErase')}
        confirmIsDestructive
        areButtonsInColumn
        confirmHandler={handleEraseStorage}
        onClose={closeModal}
        onCloseAnimationEnd={dismissDialog}
      />
    );
  };

  const renderDialog = (dialog: ApiDialog) => {
    if (dialog.type === 'storageLocked') {
      return renderStorageLockedDialog();
    }

    if (dialog.type === 'message') {
      return renderFormattedTextDialog(dialog);
    }

    if (dialog.type === 'localized') {
      return renderLocalizedDialog(dialog);
    }

    return renderError(dialog);
  };

  return Boolean(dialogs.length) && renderDialog(dialogs[dialogs.length - 1]);
};

function getErrorHeader(lang: LangFn, error: ApiDialogError) {
  if (error.isSlowMode) {
    return lang('SlowmodeEnabled');
  }

  if (!error.hasErrorKey) {
    return APP_NAME;
  }

  return lang('SomethingWentWrong');
}

export default memo(withGlobal(
  (global): Complete<StateProps> => {
    return {
      dialogs: selectTabState(global).dialogs,
    };
  },
)(Dialogs));
