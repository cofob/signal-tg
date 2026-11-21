import { memo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { AccountSettings } from '../../../types';
import { SettingsScreens } from '../../../types';

import { AUTODOWNLOAD_FILESIZE_MB_LIMITS } from '../../../config';
import { selectSharedSettings } from '../../../global/selectors/sharedState';
import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import { pick } from '../../../util/iteratees';
import { clearMediaCache } from '../../../util/settingsActions';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandTitle } from '../../gili/layout/Island';
import Checkbox from '../../ui/Checkbox';
import ListItem from '../../ui/ListItem';
import RangeSlider from '../../ui/RangeSlider';

type OwnProps = {
  isActive?: boolean;
  onReset: NoneToVoidFunction;
};

type StateProps = Pick<AccountSettings, (
  'canAutoLoadPhotoFromContacts' |
  'canAutoLoadPhotoInPrivateChats' |
  'canAutoLoadPhotoInGroups' |
  'canAutoLoadVideoFromContacts' |
  'canAutoLoadVideoInPrivateChats' |
  'canAutoLoadVideoInGroups' |
  'canAutoLoadFileFromContacts' |
  'canAutoLoadFileInPrivateChats' |
  'canAutoLoadFileInGroups' |
  'autoLoadFileMaxSizeMb'
)> & {
  signalProxyUrl?: string;
  signalSealedSenderProxyUrl?: string;
  shouldAskWhereToSave?: boolean;
};

const SettingsDataStorage = ({
  isActive,
  canAutoLoadPhotoFromContacts,
  canAutoLoadPhotoInPrivateChats,
  canAutoLoadPhotoInGroups,
  canAutoLoadVideoFromContacts,
  canAutoLoadVideoInPrivateChats,
  canAutoLoadVideoInGroups,
  canAutoLoadFileFromContacts,
  canAutoLoadFileInPrivateChats,
  canAutoLoadFileInGroups,
  autoLoadFileMaxSizeMb,
  signalProxyUrl,
  signalSealedSenderProxyUrl,
  shouldAskWhereToSave,
  onReset,
}: OwnProps & StateProps) => {
  const { setSettingOption, setSharedSettingOption, openSettingsScreen } = getActions();

  const lang = useLang();

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  const handleClearMediaCache = useLastCallback(() => {
    clearMediaCache();
  });

  const renderFileSizeCallback = useLastCallback((value: number) => {
    const size = AUTODOWNLOAD_FILESIZE_MB_LIMITS[value];
    return lang('AutodownloadSizeLimitUpTo', {
      limit: lang('MediaSizeMB', { size }, { pluralValue: size }),
    });
  });

  const handleFileSizeChange = useLastCallback((value: number) => {
    setSettingOption({ autoLoadFileMaxSizeMb: AUTODOWNLOAD_FILESIZE_MB_LIMITS[value] });
  });

  const handleAskWhereToSaveChange = useLastCallback((isChecked: boolean) => {
    setSharedSettingOption({ shouldAskWhereToSave: isChecked });
  });

  const handleOpenSignalProxy = useLastCallback(() => {
    openSettingsScreen({ screen: SettingsScreens.SignalProxy });
  });

  const handleOpenSealedSenderProxy = useLastCallback(() => {
    openSettingsScreen({ screen: SettingsScreens.SignalSealedSenderProxy });
  });

  function renderContentSizeSlider() {
    const value = AUTODOWNLOAD_FILESIZE_MB_LIMITS.indexOf(autoLoadFileMaxSizeMb);

    return (
      <div>
        <RangeSlider
          label={lang('AutoDownloadMaxFileSize')}
          min={0}
          max={5}
          value={value !== -1 ? value : 2}
          renderValue={renderFileSizeCallback}
          onChange={handleFileSizeChange}
        />
      </div>
    );
  }

  function renderAutoDownloadBlock(
    title: string,
    key: 'Photo' | 'Video' | 'File',
    canAutoLoadFromContacts: boolean,
    canAutoLoadInPrivateChats: boolean,
    canAutoLoadInGroups: boolean,
  ) {
    return (
      <>
        <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{title}</IslandTitle>
        <Island>
          <Checkbox
            label={lang('AutoDownloadSettingsContacts')}
            checked={canAutoLoadFromContacts}
            // TODO rewrite to support `useCallback`
            onCheck={(isChecked) => setSettingOption({ [`canAutoLoad${key}FromContacts`]: isChecked })}
          />
          <Checkbox
            label={lang('AutoDownloadSettingsPrivateChats')}
            checked={canAutoLoadInPrivateChats}
            onCheck={(isChecked) => setSettingOption({ [`canAutoLoad${key}InPrivateChats`]: isChecked })}
          />
          <Checkbox
            label={lang('AutoDownloadSettingsGroupChats')}
            checked={canAutoLoadInGroups}
            onCheck={(isChecked) => setSettingOption({ [`canAutoLoad${key}InGroups`]: isChecked })}
          />
          {key === 'File' && renderContentSizeSlider()}
        </Island>
      </>
    );
  }

  return (
    <div className="settings-content custom-scroll">
      {renderAutoDownloadBlock(
        lang('AutoDownloadPhotosTitle'),
        'Photo',
        canAutoLoadPhotoFromContacts,
        canAutoLoadPhotoInPrivateChats,
        canAutoLoadPhotoInGroups,
      )}
      {renderAutoDownloadBlock(
        lang('AutoDownloadVideosTitle'),
        'Video',
        canAutoLoadVideoFromContacts,
        canAutoLoadVideoInPrivateChats,
        canAutoLoadVideoInGroups,
      )}
      {renderAutoDownloadBlock(
        lang('AutoDownloadFilesTitle'),
        'File',
        canAutoLoadFileFromContacts,
        canAutoLoadFileInPrivateChats,
        canAutoLoadFileInGroups,
      )}
      {IS_TAURI && (
        <Island>
          <Checkbox
            label={lang('SettingsAskWhereToSave')}
            subLabel={lang('SettingsAskWhereToSaveDescription')}
            checked={Boolean(shouldAskWhereToSave)}
            onCheck={handleAskWhereToSaveChange}
          />
        </Island>
      )}
      <Island>
        <ListItem
          onClick={handleClearMediaCache}
          icon="delete"
          multiline
        >
          <span className="title">
            {lang('SettingsDataClearMediaCache')}
          </span>
          <span className="subtitle">
            {lang('SettingsDataClearMediaCacheDescription')}
          </span>
        </ListItem>
      </Island>
      <Island>
        <ListItem
          icon="web"
          narrow
          onClick={handleOpenSignalProxy}
        >
          {lang('SignalProxyTitle')}
          <span className="settings-item__current-value">
            {signalProxyUrl ? new URL(signalProxyUrl).host : lang('SignalProxyDefault')}
          </span>
        </ListItem>
        <ListItem
          icon="lock"
          multiline
          onClick={handleOpenSealedSenderProxy}
        >
          <span className="title">{lang('SignalSealedProxyTitle')}</span>
          <span className="subtitle">
            {signalSealedSenderProxyUrl
              ? new URL(signalSealedSenderProxyUrl).host
              : lang('SignalSealedProxySame')}
          </span>
        </ListItem>
      </Island>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const accountSettings = pick(global.settings.byKey, [
      'canAutoLoadPhotoFromContacts',
      'canAutoLoadPhotoInPrivateChats',
      'canAutoLoadPhotoInGroups',
      'canAutoLoadVideoFromContacts',
      'canAutoLoadVideoInPrivateChats',
      'canAutoLoadVideoInGroups',
      'canAutoLoadFileFromContacts',
      'canAutoLoadFileInPrivateChats',
      'canAutoLoadFileInGroups',
      'autoLoadFileMaxSizeMb',
    ]);
    const { signalProxyUrl, signalSealedSenderProxyUrl, shouldAskWhereToSave } = selectSharedSettings(global);

    return {
      ...accountSettings,
      signalProxyUrl,
      signalSealedSenderProxyUrl,
      shouldAskWhereToSave,
    };
  },
)(SettingsDataStorage));
