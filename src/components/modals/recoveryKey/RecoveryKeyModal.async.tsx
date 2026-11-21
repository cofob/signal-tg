import type { OwnProps } from './RecoveryKeyModal';

import { Bundles } from '../../../util/moduleLoader';

import useModuleLoader from '../../../hooks/useModuleLoader';

const RecoveryKeyModalAsync = (props: OwnProps) => {
  const { modal } = props;
  const RecoveryKeyModal = useModuleLoader(Bundles.Extra, 'RecoveryKeyModal', !modal);

  return RecoveryKeyModal ? <RecoveryKeyModal {...props} /> : undefined;
};

export default RecoveryKeyModalAsync;
