type MiddleFooterParams = {
  canPost?: boolean;
  withExtraShift?: boolean;
  isPinnedMessageList?: boolean;
  canUnpin?: boolean;
  canJoin?: boolean;
  shouldSendJoinRequest?: boolean;
  canUnblock?: boolean;
};

export function getHasFooterActionBar({
  canJoin, shouldSendJoinRequest, canUnblock, isPinnedMessageList, canUnpin,
}: MiddleFooterParams) {
  return Boolean(
    canJoin || shouldSendJoinRequest || canUnblock || (isPinnedMessageList && canUnpin),
  );
}

export default function getHasMiddleFooter(params: MiddleFooterParams) {
  const { canPost, withExtraShift } = params;

  return Boolean(
    canPost || withExtraShift || getHasFooterActionBar(params),
  );
}
