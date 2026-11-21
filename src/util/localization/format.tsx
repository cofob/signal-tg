import type { LangFn } from './types';

import { STARS_ICON_PLACEHOLDER } from '../../config';
import buildClassName from '../buildClassName';

import Icon from '../../components/common/icons/Icon';
import StarIcon from '../../components/common/icons/StarIcon';

export const NEXT_ARROW_REPLACEMENT = {
  '>': <Icon name="next-link" className="link-arrow-icon" />,
};
export const PREVIOUS_ARROW_REPLACEMENT = {
  '<': <Icon name="previous-link" className="link-arrow-icon" />,
};

export function formatStarsAsText(lang: LangFn, amount: number) {
  return lang('StarsAmountText', { amount }, { pluralValue: amount });
}

export function formatStarsAsIcon(lang: LangFn, amount: number | string, options?: {
  asFont?: boolean;
  className?: string;
  containerClassName?: string;
  withWrapper?: boolean;
  withIconLast?: boolean;
}) {
  const { asFont, className, containerClassName, withWrapper, withIconLast } = options || {};
  const iconClassName = buildClassName(withIconLast && 'in-text-icon-last', className);
  const icon = asFont
    ? <Icon name="star" className={buildClassName('in-text-icon', iconClassName)} />
    : <StarIcon type="gold" className={iconClassName} size="adaptive" />;
  const key = withIconLast ? 'StarsAmountIconLast' : 'StarsAmount';

  if (containerClassName || withWrapper) {
    return (
      <span className={containerClassName}>
        {lang(key, { amount }, {
          withNodes: true,
          specialReplacement: {
            [STARS_ICON_PLACEHOLDER]: icon,
          },
        })}
      </span>
    );
  }

  return lang(key, { amount }, {
    withNodes: true,
    specialReplacement: {
      [STARS_ICON_PLACEHOLDER]: icon,
    },
  });
}
