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
  'canAutoLoadPhotoInChannels' |
  'canAutoLoadVideoFromContacts' |
  'canAutoLoadVideoInPrivateChats' |
  'canAutoLoadVideoInGroups' |
  'canAutoLoadVideoInChannels' |
  'canAutoLoadFileFromContacts' |
  'canAutoLoadFileInPrivateChats' |
  'canAutoLoadFileInGroups' |
  'canAutoLoadFileInChannels' |
  'autoLoadFileMaxSizeMb'
)> & {
  signalProxyUrl?: string;
  shouldAskWhereToSave?: boolean;
};

const SettingsDataStorage = ({
  isActive,
  canAutoLoadPhotoFromContacts,
  canAutoLoadPhotoInPrivateChats,
  canAutoLoadPhotoInGroups,
  canAutoLoadPhotoInChannels,
  canAutoLoadVideoFromContacts,
  canAutoLoadVideoInPrivateChats,
  canAutoLoadVideoInGroups,
  canAutoLoadVideoInChannels,
  canAutoLoadFileFromContacts,
  canAutoLoadFileInPrivateChats,
  canAutoLoadFileInGroups,
  canAutoLoadFileInChannels,
  autoLoadFileMaxSizeMb,
  signalProxyUrl,
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
    canAutoLoadInChannels: boolean,
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
          <Checkbox
            label={lang('AutoDownloadSettingsChannels')}
            checked={canAutoLoadInChannels}
            onCheck={(isChecked) => setSettingOption({ [`canAutoLoad${key}InChannels`]: isChecked })}
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
        canAutoLoadPhotoInChannels,
      )}
      {renderAutoDownloadBlock(
        lang('AutoDownloadVideosTitle'),
        'Video',
        canAutoLoadVideoFromContacts,
        canAutoLoadVideoInPrivateChats,
        canAutoLoadVideoInGroups,
        canAutoLoadVideoInChannels,
      )}
      {renderAutoDownloadBlock(
        lang('AutoDownloadFilesTitle'),
        'File',
        canAutoLoadFileFromContacts,
        canAutoLoadFileInPrivateChats,
        canAutoLoadFileInGroups,
        canAutoLoadFileInChannels,
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
      'canAutoLoadPhotoInChannels',
      'canAutoLoadVideoFromContacts',
      'canAutoLoadVideoInPrivateChats',
      'canAutoLoadVideoInGroups',
      'canAutoLoadVideoInChannels',
      'canAutoLoadFileFromContacts',
      'canAutoLoadFileInPrivateChats',
      'canAutoLoadFileInGroups',
      'canAutoLoadFileInChannels',
      'autoLoadFileMaxSizeMb',
    ]);
    const { signalProxyUrl, shouldAskWhereToSave } = selectSharedSettings(global);

    return {
      ...accountSettings,
      signalProxyUrl,
      shouldAskWhereToSave,
    };
  },
)(SettingsDataStorage));
