import { memo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import { DEBUG_LOG_FILENAME } from '../../../config';
import { selectSharedSettings } from '../../../global/selectors/sharedState';
import { IS_WAVE_TRANSFORM_SUPPORTED } from '../../../util/browser/windowEnvironment';
import { getDebugLogs } from '../../../util/debugConsole';
import download from '../../../util/download';
import { LOCAL_TGS_URLS } from '../../common/helpers/animatedAssets';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import AnimatedIconWithPreview from '../../common/AnimatedIconWithPreview';
import Island from '../../gili/layout/Island';
import Checkbox from '../../ui/Checkbox';
import ListItem from '../../ui/ListItem';

type OwnProps = {
  isActive?: boolean;
  onReset: () => void;
};

type StateProps = {
  shouldCollectDebugLogs?: boolean;
};

const SettingsExperimental = ({
  isActive,
  shouldCollectDebugLogs,
  onReset,
}: OwnProps & StateProps) => {
  const { requestConfetti, setSharedSettingOption, requestWave } = getActions();

  const lang = useLang();

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  const handleDownloadLog = useLastCallback(() => {
    const file = new File([getDebugLogs()], DEBUG_LOG_FILENAME, { type: 'text/plain' });
    const url = URL.createObjectURL(file);
    download(url, DEBUG_LOG_FILENAME);
  });

  const handleRequestWave = useLastCallback((e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    requestWave({ startX: e.clientX, startY: e.clientY });
  });

  const handleRequestConfetti = useLastCallback(() => {
    requestConfetti({ withStars: true });
  });

  return (
    <div className="settings-content custom-scroll">
      <div className="settings-content-header no-border">
        <AnimatedIconWithPreview
          tgsUrl={LOCAL_TGS_URLS.Experimental}
          size={200}
          className="experimental-duck"
          nonInteractive
          noLoop={false}
        />
        <p className="settings-item-description pt-3" dir="auto">{lang('SettingsExperimentalAbout')}</p>
      </div>
      <Island>
        <ListItem
          onClick={handleRequestConfetti}
          icon="animations"
        >
          <div className="title">{lang('LaunchConfetti')}</div>
        </ListItem>
        <ListItem
          onClick={handleRequestWave}
          icon="story-expired"
          disabled={!IS_WAVE_TRANSFORM_SUPPORTED}
        >
          <div className="title">{lang('SettingsStartWave')}</div>
        </ListItem>
      </Island>
      <Island>
        <Checkbox
          label={lang('DebugMenuEnableLogs')}
          checked={Boolean(shouldCollectDebugLogs)}
          onCheck={() => setSharedSettingOption({ shouldCollectDebugLogs: !shouldCollectDebugLogs })}
        />
        <ListItem
          onClick={handleDownloadLog}
          icon="bug"
        >
          <div className="title">{lang('DebugDownloadLog')}</div>
        </ListItem>
      </Island>
    </div>
  );
};

export default memo(withGlobal(
  (global): Complete<StateProps> => {
    const { shouldCollectDebugLogs } = selectSharedSettings(global);

    return { shouldCollectDebugLogs };
  },
)(SettingsExperimental));
