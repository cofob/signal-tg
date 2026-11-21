import type { OwnProps } from './SafetyNumberModal';

import { Bundles } from '../../../util/moduleLoader';

import useModuleLoader from '../../../hooks/useModuleLoader';

const SafetyNumberModalAsync = (props: OwnProps) => {
  const { modal } = props;
  const SafetyNumberModal = useModuleLoader(Bundles.Extra, 'SafetyNumberModal', !modal);

  return SafetyNumberModal ? <SafetyNumberModal {...props} /> : undefined;
};

export default SafetyNumberModalAsync;
