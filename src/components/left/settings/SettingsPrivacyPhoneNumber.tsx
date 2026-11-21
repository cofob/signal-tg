import { memo, useEffect, useMemo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Island, { IslandDescription, IslandTitle } from '../../gili/layout/Island';
import RadioGroup from '../../ui/RadioGroup';

type OwnProps = {
  isActive?: boolean;
  onReset: NoneToVoidFunction;
};

type StateProps = {
  isShared?: boolean;
  isDiscoverable?: boolean;
};

const EVERYBODY = 'everybody';
const NOBODY = 'nobody';

/**
 * Signal's phone number privacy (Signal Desktop `Preferences`): who sees the number on our profile, and, while
 * nobody does, whether people who have it can find us
 */
const SettingsPrivacyPhoneNumber = ({
  isActive,
  isShared,
  isDiscoverable,
  onReset,
}: OwnProps & StateProps) => {
  const { loadPhoneNumberPrivacy, updatePhoneNumberPrivacy } = getActions();

  const lang = useLang();

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  useEffect(() => {
    if (isActive) loadPhoneNumberPrivacy();
  }, [isActive]);

  const options = useMemo(() => [
    { value: EVERYBODY, label: lang('P2PEverybody') },
    { value: NOBODY, label: lang('P2PNobody') },
  ], [lang]);

  const handleSharingChange = useLastCallback((value: string) => {
    updatePhoneNumberPrivacy({ isShared: value === EVERYBODY });
  });

  const handleDiscoverabilityChange = useLastCallback((value: string) => {
    updatePhoneNumberPrivacy({ isDiscoverable: value === EVERYBODY });
  });

  const isLoaded = isShared !== undefined;

  return (
    <div className="settings-content custom-scroll">
      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('PrivacyPhoneTitle')}</IslandTitle>
      <Island>
        <RadioGroup
          name="phone-number-sharing"
          options={options}
          selected={isLoaded ? (isShared ? EVERYBODY : NOBODY) : undefined}
          disabled={!isLoaded}
          onChange={handleSharingChange}
        />
      </Island>
      <IslandDescription dir={lang.isRtl ? 'rtl' : undefined}>
        {lang(isShared ? 'SignalPhoneSharedInfo' : 'SignalPhoneHiddenInfo')}
      </IslandDescription>

      {isLoaded && !isShared && (
        <>
          <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('PrivacyPhoneTitle2')}</IslandTitle>
          <Island>
            <RadioGroup
              name="phone-number-discoverability"
              options={options}
              selected={isDiscoverable ? EVERYBODY : NOBODY}
              onChange={handleDiscoverabilityChange}
            />
          </Island>
          <IslandDescription dir={lang.isRtl ? 'rtl' : undefined}>
            {lang(isDiscoverable ? 'SignalPhoneDiscoverableInfo' : 'SignalPhoneUnlistedInfo')}
          </IslandDescription>
        </>
      )}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const { phoneNumber, addByPhone } = global.settings.privacy;

    return {
      isShared: phoneNumber && phoneNumber.visibility === 'everybody',
      isDiscoverable: addByPhone && addByPhone.visibility === 'everybody',
    };
  },
)(SettingsPrivacyPhoneNumber));
