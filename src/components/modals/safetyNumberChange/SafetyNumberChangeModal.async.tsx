import type { OwnProps } from './SafetyNumberChangeModal';

import { Bundles } from '../../../util/moduleLoader';

import useModuleLoader from '../../../hooks/useModuleLoader';

const SafetyNumberChangeModalAsync = (props: OwnProps) => {
  const { modal } = props;
  const SafetyNumberChangeModal = useModuleLoader(Bundles.Extra, 'SafetyNumberChangeModal', !modal);

  return SafetyNumberChangeModal ? <SafetyNumberChangeModal {...props} /> : undefined;
};

export default SafetyNumberChangeModalAsync;
