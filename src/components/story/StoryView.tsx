import { memo, useMemo } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiAvailableReaction, ApiTypeStoryView } from '../../api/types';
import type { IconName } from '../../types/icons';

import buildClassName from '../../util/buildClassName';
import { isUserId } from '../../util/entities/ids';
import { formatCalendarDate, secondsToDate } from '../../util/localization/dateFormat';
import { REM } from '../common/helpers/mediaDimensions';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import GroupChatInfo from '../common/GroupChatInfo';
import PrivateChatInfo from '../common/PrivateChatInfo';
import ReactionStaticEmoji from '../common/reactions/ReactionStaticEmoji';
import ListItem from '../ui/ListItem';

import styles from './StoryViewModal.module.scss';

type OwnProps = {
  storyView: ApiTypeStoryView;
};

type StateProps = {
  availableReactions?: ApiAvailableReaction[];
};

const CLOSE_ANIMATION_DURATION = 100;
const DEFAULT_REACTION_SIZE = 1.5 * REM;
const BULLET = '•';

/** A viewer of our story with their reaction, or a reply to it; clicking opens the chat with them */
const StoryView = ({
  storyView,
  availableReactions,
}: OwnProps & StateProps) => {
  const { openChat, closeStoryViewer } = getActions();

  const lang = useLang();
  const isReply = storyView.type === 'reply';
  const reaction = storyView.type === 'user' || storyView.type === 'reply' ? storyView.reaction : undefined;

  const handleClick = useLastCallback(() => {
    closeStoryViewer();
    setTimeout(() => {
      openChat({ id: storyView.peerId });
    }, CLOSE_ANIMATION_DURATION);
  });

  const statusIcon: IconName = isReply ? 'story-reply' : 'message-read';

  const status = useMemo(() => {
    const date = formatCalendarDate(lang, secondsToDate(storyView.date), {
      variant: 'date', isShort: true, withTime: true,
    });
    const text = storyView.type === 'reply' ? storyView.text?.text : undefined;
    return text ? `${text} ${BULLET} ${date}` : date;
  }, [lang, storyView]);

  return (
    <ListItem
      key={storyView.peerId}
      className={buildClassName('chat-item-clickable small-icon', styles.opacityFadeIn)}
      onClick={handleClick}
      rightElement={reaction ? (
        <ReactionStaticEmoji
          reaction={reaction}
          className={styles.viewReaction}
          size={DEFAULT_REACTION_SIZE}
          availableReactions={availableReactions}
          withIconHeart
        />
      ) : undefined}
    >
      {isUserId(storyView.peerId) ? (
        <PrivateChatInfo
          userId={storyView.peerId}
          noStatusOrTyping
          status={status}
          statusIcon={statusIcon}
          withStory
          forceShowSelf
        />
      ) : (
        <GroupChatInfo
          chatId={storyView.peerId}
          status={status}
          statusIcon={statusIcon}
          withStory
        />
      )}
    </ListItem>
  );
};

export default memo(withGlobal<OwnProps>((global): Complete<StateProps> => {
  return {
    availableReactions: global.reactions.availableReactions,
  };
})(StoryView));
