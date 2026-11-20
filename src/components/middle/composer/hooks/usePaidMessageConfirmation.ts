import { useEffect, useRef, useState } from '../../../../lib/teact/teact';
import { getActions, getGlobal } from '../../../../global';

import { selectTabState } from '../../../../global/selectors';

import useLastCallback from '../../../../hooks/useLastCallback';

export default function usePaidMessageConfirmation(
  dialogKey: string,
  starsForAllMessages: number,
  shouldDelayConfirmHandler?: boolean,
) {
  const {
    shouldPaidMessageAutoApprove,
  } = getGlobal().settings.byKey;

  const [shouldAutoApprove, setShouldAutoApprove] = useState(Boolean(shouldPaidMessageAutoApprove));
  const confirmPaymentHandlerRef = useRef<NoneToVoidFunction | undefined>(undefined);

  const closeConfirmDialog = useLastCallback(() => {
    getActions().closePaymentMessageConfirmDialogOpen();
  });

  useEffect(() => {
    return () => {
      const { paymentMessageConfirmDialogKey } = selectTabState(getGlobal());
      if (paymentMessageConfirmDialogKey === dialogKey) {
        getActions().closePaymentMessageConfirmDialogOpen();
      }
    };
  }, [dialogKey]);

  const dialogHandler = useLastCallback(() => {
    if (shouldDelayConfirmHandler) {
      setTimeout(() => {
        confirmPaymentHandlerRef?.current?.();
      }, 250);
    } else {
      confirmPaymentHandlerRef?.current?.();
    }

    getActions().closePaymentMessageConfirmDialogOpen();
    if (shouldAutoApprove) getActions().setPaidMessageAutoApprove();
  });

  const handleWithConfirmation = useLastCallback(<T extends (...args: any[]) => void>(
    handler: T,
    ...args: Parameters<T>
  ) => {
    if (starsForAllMessages) {
      confirmPaymentHandlerRef.current = () => handler(...args);
      if (!shouldPaidMessageAutoApprove) {
        getActions().openPaymentMessageConfirmDialogOpen({ dialogKey });
        return;
      }
    }

    handler(...args);
  });

  return {
    closeConfirmDialog,
    handleWithConfirmation,
    dialogHandler,
    shouldAutoApprove,
    setAutoApprove: setShouldAutoApprove,
  };
}
