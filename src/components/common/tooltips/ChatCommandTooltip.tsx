import { memo, useEffect, useRef } from '../../../lib/teact/teact';
import { getGlobal } from '../../../global';

import type { ApiBotCommand } from '../../../api/types';

import buildClassName from '../../../util/buildClassName';

import useFrozenProps from '../../../hooks/useFrozenProps';
import useLastCallback from '../../../hooks/useLastCallback';

import ChatCommand from '../../middle/composer/ChatCommand';
import RichEditorTooltipPanel from './RichEditorTooltipPanel';

import sharedStyles from './RichEditorTooltip.module.scss';

export type OwnProps = {
  isOpen: boolean;
  selectedIndex: number;
  botCommands?: ApiBotCommand[];
  onCommandSelect: (command: ApiBotCommand) => void;
};

const ChatCommandTooltip = ({ isOpen, ...props }: OwnProps) => {
  const {
    selectedIndex,
    botCommands,
    onCommandSelect,
  } = useFrozenProps(props, !isOpen);

  const containerRef = useRef<HTMLDivElement>();

  const handleSendCommand = useLastCallback((command: ApiBotCommand) => onCommandSelect(command));
  useEffect(() => {
    containerRef.current?.querySelector<HTMLElement>('.focus')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!botCommands?.length) {
    return undefined;
  }

  return (
    <RichEditorTooltipPanel isOpen={isOpen}>
      <div ref={containerRef} className={buildClassName(sharedStyles.root, 'composer-tooltip custom-scroll')}>
        {botCommands?.map((command, index) => (
          <ChatCommand
            key={`${command.botId}_${command.command}`}
            command={command.command}
            description={command.description}
            isEphemeral={command.isEphemeral}
            // No need for expensive global updates on users and chats, so we avoid them
            peer={getGlobal().users.byId[command.botId]}
            withAvatar
            clickArg={command}
            onClick={handleSendCommand}
            focus={selectedIndex === index}
          />
        ))}
      </div>
    </RichEditorTooltipPanel>
  );
};

export default memo(ChatCommandTooltip);
