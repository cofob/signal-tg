import type { OwnProps } from './StoryComposerModal';

import { Bundles } from '../../util/moduleLoader';

import useModuleLoader from '../../hooks/useModuleLoader';

const StoryComposerModalAsync = (props: OwnProps) => {
  const { modal } = props;
  const StoryComposerModal = useModuleLoader(Bundles.Extra, 'StoryComposerModal', !modal);

  return StoryComposerModal ? <StoryComposerModal {...props} /> : undefined;
};

export default StoryComposerModalAsync;
