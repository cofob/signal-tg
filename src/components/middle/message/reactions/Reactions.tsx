import { memo, useMemo } from '../../../../lib/teact/teact';
import { getActions, getGlobal } from '../../../../global';

import type {
  ApiMessage,
  ApiPeer,
  ApiReaction,
  ApiReactionKey,
} from '../../../../api/types';
import type { ObserveFn } from '../../../../hooks/useIntersectionObserver';
import type { ThreadId } from '../../../../types';

import { getReactionKey, isReactionChosen } from '../../../../global/helpers';
import { selectPeer } from '../../../../global/selectors';
import buildClassName from '../../../../util/buildClassName';
import { getMessageKey } from '../../../../util/keys/messageKey';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import ReactionButton from './ReactionButton';

import './Reactions.scss';

type OwnProps = {
  message: ApiMessage;
  threadId?: ThreadId;
  isOutside?: boolean;
  metaChildren?: React.ReactNode;
  observeIntersection?: ObserveFn;
  noRecentReactors?: boolean;
  isAccountFrozen?: boolean;
};

const MAX_RECENT_AVATARS = 3;

const Reactions = ({
  message,
  threadId,
  isOutside,
  metaChildren,
  observeIntersection,
  noRecentReactors,
  isAccountFrozen,
}: OwnProps) => {
  const {
    toggleReaction,
    openFrozenAccountModal,
  } = getActions();
  const lang = useLang();

  const { results, recentReactions } = message.reactions!;
  const withServiceReactions = Boolean(message.areReactionsPossible && message.reactions);

  const totalCount = useMemo(() => (
    results.reduce((acc, reaction) => acc + reaction.count, 0)
  ), [results]);

  const recentReactorsByReactionKey = useMemo(() => {
    const global = getGlobal();

    return recentReactions?.reduce((acc, recentReaction) => {
      const { reaction, peerId } = recentReaction;
      const key = getReactionKey(reaction);
      const peer = selectPeer(global, peerId);

      if (!peer) return acc;

      const peers = acc[key] || [];
      peers.push(peer);
      acc[key] = peers;
      return acc;
    }, {} as Record<ApiReactionKey, ApiPeer[]>);
  }, [recentReactions]);

  const props = useMemo(() => {
    const messageKey = getMessageKey(message);
    return results.map((reaction) => {
      const reactionKey = getReactionKey(reaction.reaction);
      const recentReactors = recentReactorsByReactionKey?.[reactionKey];
      const shouldHideRecentReactors = totalCount > MAX_RECENT_AVATARS || noRecentReactors;

      return {
        reaction,
        reactionKey,
        messageKey,
        recentReactors: !shouldHideRecentReactors ? recentReactors : undefined,
        isChosen: isReactionChosen(reaction),
      };
    });
  }, [message, noRecentReactors, recentReactorsByReactionKey, results, totalCount]);

  const handleClick = useLastCallback((reaction: ApiReaction) => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      return;
    }
    toggleReaction({
      chatId: message.chatId,
      messageId: message.id,
      reaction,
    });
  });

  return (
    <div
      className={buildClassName(
        'Reactions',
        isOutside && 'is-outside',
        withServiceReactions && 'is-service',
      )}
      dir={lang.isRtl ? 'rtl' : 'ltr'}
    >
      {props.map(({
        reaction, recentReactors, messageKey, reactionKey,
      }) => (
        <ReactionButton
          key={reactionKey}
          className="message-reaction"
          chosenClassName="chosen"
          containerId={messageKey}
          isOwnMessage={message.isOutgoing}
          recentReactors={recentReactors}
          isOutside={isOutside}
          reaction={reaction}
          onClick={handleClick}
          observeIntersection={observeIntersection}
        />
      ))}
      {metaChildren}
    </div>
  );
};

export default memo(Reactions);
