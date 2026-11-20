import type { ChangeEvent } from 'react';
import { memo, useCallback, useMemo } from '../../../lib/teact/teact';

import type { ApiPremiumSubscriptionOption } from '../../../api/types';

import buildClassName from '../../../util/buildClassName';
import { formatCurrencyAsString } from '../../../util/formatCurrency';

import useLang from '../../../hooks/useLang';

import styles from './PremiumSubscriptionOption.module.scss';

type OwnProps = {
  option: ApiPremiumSubscriptionOption;
  checked?: boolean;
  fullMonthlyAmount?: number;
  className?: string;
  onChange: (month: number) => void;
};

const PremiumSubscriptionOption = ({
  option, checked, fullMonthlyAmount,
  onChange, className,
}: OwnProps) => {
  const lang = useLang();

  const {
    months, amount, currency,
  } = option;
  const perMonth = Math.floor(amount / months);

  const discount = useMemo(() => {
    return fullMonthlyAmount && fullMonthlyAmount > perMonth
      ? Math.ceil(100 - perMonth / (fullMonthlyAmount / 100))
      : undefined;
  }, [fullMonthlyAmount, perMonth]);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      onChange(months);
    }
  }, [months, onChange]);

  return (
    <label
      className={buildClassName(
        styles.wrapper,
        checked && styles.active,
        className,
      )}
      dir={lang.isRtl ? 'rtl' : undefined}
    >
      <input
        className={styles.input}
        type="radio"
        name="subscription_option"
        value={months}
        checked={checked}
        onChange={handleChange}
      />
      <div className={styles.content}>
        <div className={styles.month}>
          {Boolean(discount) && (
            <span
              className={styles.discount}
              title={lang('GiftDiscount', { percent: discount })}
            >
              {lang('GiftDiscount', { percent: discount })}
            </span>
          )}
          {lang('Months', { count: months }, { pluralValue: months })}
        </div>
        <div className={styles.perMonth}>
          {lang('PricePerMonth', { amount: formatCurrencyAsString(perMonth, currency, lang.code) })}
        </div>
        <div className={styles.amount}>
          {formatCurrencyAsString(amount, currency, lang.code)}
        </div>
      </div>
    </label>
  );
};

export default memo(PremiumSubscriptionOption);
