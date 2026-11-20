import { memo, useMemo } from '../../lib/teact/teact';

import useLang from '../../hooks/useLang';

import Button from '../ui/Button';
import Modal, {
  ModalCloseButton,
  ModalFooterActions,
  ModalHeader,
  ModalTitle,
} from '@gili/modal/Modal';

type OwnProps = {
  isOpen: boolean;
  onClose: NoneToVoidFunction;
  onCloseAnimationEnd: NoneToVoidFunction;
  onRemoveFormatting: NoneToVoidFunction;
};

const RemoveFormattingModal = ({
  isOpen,
  onClose,
  onCloseAnimationEnd,
  onRemoveFormatting,
}: OwnProps) => {
  const lang = useLang();
  const title = lang('RemoveRichFormattingTitle');

  const header = useMemo(() => (
    <ModalHeader>
      <ModalCloseButton />
      <ModalTitle>{title}</ModalTitle>
    </ModalHeader>
  ), [title]);

  return (
    <Modal
      isOpen={isOpen}
      header={header}
      width="slim"
      height="auto"
      ariaLabel={title}
      onClose={onClose}
      onCloseAnimationEnd={onCloseAnimationEnd}
    >
      <p>
        {lang('RemoveRichFormattingText', undefined, { withNodes: true, withMarkdown: true })}
      </p>
      <ModalFooterActions isVertical>
        <Button
          size="smaller"
          color="primary"
          fluid
          onClick={onRemoveFormatting}
        >
          {lang('RemoveRichFormatting')}
        </Button>
      </ModalFooterActions>
    </Modal>
  );
};

export default memo(RemoveFormattingModal);
