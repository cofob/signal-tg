import {
  memo, useEffect, useMemo, useRef, useState,
} from '../../../lib/teact/teact';
import { getActions, getPromiseActions, withGlobal } from '../../../global';

import type { SharedSettings } from '../../../global/types';

import { selectSharedSettings } from '../../../global/selectors/sharedState';
import { getTranslationFn } from '../../../util/localization';

import useFlag from '../../../hooks/useFlag';
import useHistoryBack from '../../../hooks/useHistoryBack';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import ItemPicker, { type ItemPickerOption } from '../../common/pickers/ItemPicker';
import PickerItem from '../../common/pickers/PickerItem';
import Island, { IslandTitle } from '../../gili/layout/Island';
import DropdownMenu from '../../ui/DropdownMenu';
import Loading from '../../ui/Loading';
import MenuItem from '../../ui/MenuItem';
import Radio from '../../ui/Radio';
import Transition from '../../ui/Transition';

type OwnProps = {
  isActive?: boolean;
  onReset: () => void;
};

type StateProps = Pick<SharedSettings, 'language' | 'languages' | 'customLanguages'>;

const SettingsLanguage = ({
  isActive,
  languages,
  language,
  customLanguages,
  onReset,
}: OwnProps & StateProps) => {
  const {
    loadLanguages,
    removeCustomLanguage,
  } = getActions();

  const lang = useLang();

  const [selectedLanguage, setSelectedLanguage] = useState<string>(language);
  const [isLoading, markIsLoading, unmarkIsLoading] = useFlag();
  const languageRequestRef = useRef(0);

  useEffect(() => {
    if (!languages?.length) {
      loadLanguages();
    }
  }, [languages]);

  const handleChange = useLastCallback(async (langCode: string) => {
    const newLanguage = languages?.find((item) => item.langCode === langCode)
      || customLanguages?.find((item) => item.langCode === langCode);
    if (!newLanguage) return;

    const requestId = ++languageRequestRef.current;
    setSelectedLanguage(langCode);
    markIsLoading();

    try {
      await getPromiseActions().applyLanguage({ language: newLanguage });
    } finally {
      if (requestId === languageRequestRef.current) {
        setSelectedLanguage(getTranslationFn().rawCode);
        unmarkIsLoading();
      }
    }
  });

  const savedLanguages = useMemo(() => customLanguages?.filter(({ langCode }) => (
    !languages?.some((item) => item.langCode === langCode)
  )), [customLanguages, languages]);

  const options = useMemo(() => {
    if (!languages) return undefined;
    const currentLangCode = (window.navigator.language || 'en').toLowerCase();
    const shortLangCode = currentLangCode.substr(0, 2);

    return languages.map(({ langCode, nativeName, name }) => ({
      value: langCode,
      label: nativeName,
      subLabel: name,
      isLoading: langCode === selectedLanguage && isLoading,
    } satisfies ItemPickerOption)).sort((a) => {
      return currentLangCode && (a.value === currentLangCode || a.value === shortLangCode) ? -1 : 0;
    });
  }, [isLoading, languages, selectedLanguage]);

  useHistoryBack({
    isActive,
    onBack: onReset,
  });

  return (
    <div className="settings-content settings-language custom-scroll">
      <IslandTitle>{lang('LocalizationInterfaceLanguage')}</IslandTitle>
      {Boolean(savedLanguages?.length) && (
        <Island>
          {savedLanguages.map((savedLanguage) => (
            <div className="settings-custom-language" key={savedLanguage.langCode}>
              <PickerItem
                title={savedLanguage.nativeName}
                subtitle={savedLanguage.name}
                inputElement={(
                  <Radio
                    checked={language === savedLanguage.langCode}
                    isLoading={isLoading && selectedLanguage === savedLanguage.langCode}
                    onlyInput
                  />
                )}
                ripple
                onClick={() => handleChange(savedLanguage.langCode)}
              />
              <DropdownMenu positionX="right" withPortal>
                <MenuItem
                  icon="delete"
                  destructive
                  disabled={language === savedLanguage.langCode}
                  onClick={() => removeCustomLanguage({ langCode: savedLanguage.langCode })}
                >
                  {lang('BoxRemove')}
                </MenuItem>
              </DropdownMenu>
            </div>
          ))}
        </Island>
      )}
      <Transition activeKey={options ? 1 : 0} name="fade" className="settings-language-transition">
        {options ? (
          <Island>
            <ItemPicker
              items={options}
              selectedValue={isLoading ? selectedLanguage : language}
              forceRenderAllItems
              onSelectedValueChange={handleChange}
              itemInputType="radio"
              className="settings-picker"
            />
          </Island>
        ) : (
          <Loading />
        )}
      </Transition>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const { language, languages, customLanguages } = selectSharedSettings(global);

    return {
      languages,
      language,
      customLanguages,
    };
  },
)(SettingsLanguage));
