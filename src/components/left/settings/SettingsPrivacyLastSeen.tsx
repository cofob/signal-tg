import { memo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { PrivacyVisibility } from '../../../api/types';

import { selectShouldHideReadMarks } from '../../../global/selectors';
import renderText from '../../common/helpers/renderText';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandDescription } from '../../gili/layout/Island';
import Checkbox from '../../ui/Checkbox';

type OwnProps = {
  visibility?: PrivacyVisibility;
};

type StateProps = {
  shouldHideReadMarks: boolean;
};

const SettingsPrivacyLastSeen = ({
  shouldHideReadMarks, visibility,
}: OwnProps & StateProps) => {
  const { updateGlobalPrivacySettings } = getActions();
  const lang = useLang();
  const canShowHideReadTime = visibility === 'nobody' || visibility === 'contacts';

  const handleChangeShouldHideReadMarks = useLastCallback(
    (isEnabled) => updateGlobalPrivacySettings({ shouldHideReadMarks: isEnabled }),
  );

  if (!canShowHideReadTime) return undefined;

  return (
    <>
      <Island>
        <Checkbox
          label={lang('HideReadTime')}
          checked={shouldHideReadMarks}
          onCheck={handleChangeShouldHideReadMarks}
        />
      </Island>
      <IslandDescription dir={lang.isRtl ? 'rtl' : undefined}>
        {renderText(lang('HideReadTimeInfo'), ['br'])}
      </IslandDescription>
    </>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    return {
      shouldHideReadMarks: Boolean(selectShouldHideReadMarks(global)),
    };
  },
)(SettingsPrivacyLastSeen));
