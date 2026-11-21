import type { OwnProps } from './MessageDetailsModal';

import { Bundles } from '../../../util/moduleLoader';

import useModuleLoader from '../../../hooks/useModuleLoader';

const MessageDetailsModalAsync = (props: OwnProps) => {
  const { modal } = props;
  const MessageDetailsModal = useModuleLoader(Bundles.Extra, 'MessageDetailsModal', !modal);

  return MessageDetailsModal ? <MessageDetailsModal {...props} /> : undefined;
};

export default MessageDetailsModalAsync;
