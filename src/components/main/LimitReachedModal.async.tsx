import type { OwnProps } from './LimitReachedModal';

import { Bundles } from '../../util/moduleLoader';

import useModuleLoader from '../../hooks/useModuleLoader';

const LimitReachedModalAsync = (props: OwnProps) => {
  const { limit } = props;
  const LimitReachedModal = useModuleLoader(Bundles.Extra, 'LimitReachedModal', !limit);

  return LimitReachedModal ? <LimitReachedModal {...props} /> : undefined;
};

export default LimitReachedModalAsync;
