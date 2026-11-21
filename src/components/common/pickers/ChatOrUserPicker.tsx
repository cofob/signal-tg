import type { ElementRef, TeactNode } from '../../../lib/teact/teact';
import {
  memo, useCallback, useEffect, useRef, useState,
} from '../../../lib/teact/teact';
import { getGlobal, withGlobal } from '../../../global';

import type { AnimationLevel } from '../../../types';

import { PEER_PICKER_ITEM_HEIGHT_PX } from '../../../config';
import { getGroupStatus, getUserStatus, isUserOnline } from '../../../global/helpers';
import { isApiPeerChat } from '../../../global/helpers/peers';
import { selectPeer, selectTabState, selectUserStatus } from '../../../global/selectors';
import { selectAnimationLevel } from '../../../global/selectors/sharedState';
import buildClassName from '../../../util/buildClassName';
import { resolveTransitionName } from '../../../util/resolveTransitionName';

import useInfiniteScroll from '../../../hooks/useInfiniteScroll';
import useInputFocusOnOpen from '../../../hooks/useInputFocusOnOpen';
import useKeyboardListNavigation from '../../../hooks/useKeyboardListNavigation';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import InfiniteScroll, { type OwnProps as InfiniteScrollProps } from '../../ui/InfiniteScroll';
import Loading from '../../ui/Loading';
import Modal from '../../ui/Modal';
import Transition from '../../ui/Transition';
import Avatar from '../Avatar';
import FullNameTitle from '../FullNameTitle';
import Icon from '../icons/Icon';
import PickerItem from './PickerItem';
import PickerSearchField from './PickerSearchField';

import './ChatOrUserPicker.scss';

export type OwnProps = {
  currentUserId?: string;
  chatOrUserIds: string[];
  isOpen: boolean;
  title?: string;
  searchPlaceholder: string;
  search: string;
  className?: string;
  isLowStackPriority?: boolean;
  isNativeDialog?: boolean;
  listActiveKey?: number;
  subheader?: TeactNode;
  renderSearchRow?: (props: SearchRowRenderProps) => TeactNode;
  footer?: TeactNode;
  viewportFooter?: TeactNode;
  selectedIds?: string[];
  loadMore?: NoneToVoidFunction;
  onSearchChange: (search: string) => void;
  onSelectChatOrUser: (chatOrUserId: string) => void;
  onClose: NoneToVoidFunction;
  onCloseAnimationEnd?: NoneToVoidFunction;
};

type StateProps = {
  animationLevel: AnimationLevel;
  shouldSkipHistoryAnimations?: boolean;
};

const ITEM_CLASS_NAME = 'ChatOrUserPicker-item';

export type SearchRowRenderProps = {
  inputRef: ElementRef<HTMLInputElement>;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
};

const ChatOrUserPicker = ({
  isOpen,
  currentUserId,
  chatOrUserIds,
  title,
  search,
  searchPlaceholder,
  className,
  isLowStackPriority,
  isNativeDialog,
  subheader,
  renderSearchRow,
  footer,
  viewportFooter,
  listActiveKey,
  selectedIds,
  animationLevel,
  shouldSkipHistoryAnimations,
  loadMore,
  onSearchChange,
  onSelectChatOrUser,
  onClose,
  onCloseAnimationEnd,
}: OwnProps & StateProps) => {
  const lang = useLang();
  const [chatKeyDownHandler, setChatKeyDownHandler] = useState<React.KeyboardEventHandler<HTMLDivElement>>();
  const searchRef = useRef<HTMLInputElement>();
  const [viewportIds, getMore] = useInfiniteScroll(loadMore, chatOrUserIds, Boolean(search));
  const viewportOffset = chatOrUserIds.indexOf(viewportIds![0]);

  const resetSearch = useLastCallback(() => {
    onSearchChange('');
  });
  useInputFocusOnOpen(searchRef, isOpen, resetSearch);

  const handleSearchChange = useLastCallback((value: string) => {
    onSearchChange(value);
  });

  const handleChatSelect = useLastCallback((index) => {
    if (viewportIds && viewportIds.length > 0) {
      onSelectChatOrUser(viewportIds[index === -1 ? 0 : index]);
    }
  });

  const handleKeyDownHandlerUpdate = useLastCallback((handler: React.KeyboardEventHandler<HTMLDivElement>) => {
    setChatKeyDownHandler(() => handler);
  });

  const renderChatItem = useCallback((id: string, index: number) => {
    const global = getGlobal();
    const peer = selectPeer(global, id);
    if (!peer) {
      return undefined;
    }

    const isSelf = peer && !isApiPeerChat(peer) ? peer.isSelf : undefined;
    const isSelected = selectedIds?.includes(id);

    function getSubtitle() {
      if (!peer) return undefined;
      if (peer.id === currentUserId) return [lang('SavedMessagesInfo')];
      if (isApiPeerChat(peer)) {
        return [getGroupStatus(lang, peer)];
      }

      const userStatus = selectUserStatus(global, peer.id);
      return [
        getUserStatus(lang, peer, userStatus),
        buildClassName(isUserOnline(peer, userStatus, true) && 'online'),
      ];
    }

    const [subtitle, subtitleClassName] = getSubtitle() || [];

    const checkboxElement = selectedIds ? (
      <div className={buildClassName('picker-checkbox', isSelected && 'selected')}>
        {isSelected && <Icon name="check" />}
      </div>
    ) : undefined;

    return (
      <PickerItem
        key={id}
        className={ITEM_CLASS_NAME}
        title={(
          <div className="title-wrapper">
            <FullNameTitle
              className="item-title"
              peer={peer}
              isSavedMessages={isSelf}
            />
          </div>
        )}
        avatarElement={(
          <Avatar
            peer={peer}
            isSavedMessages={isSelf}
            size="medium"
          />
        )}
        inputElement={checkboxElement}
        inputPosition="end"
        subtitle={subtitle}
        subtitleClassName={subtitleClassName}
        ripple
        style={`top: ${(viewportOffset + index) * PEER_PICKER_ITEM_HEIGHT_PX}px;`}

        onClick={() => onSelectChatOrUser(id)}
      />
    );
  }, [currentUserId, lang, viewportOffset, selectedIds, onSelectChatOrUser]);

  function renderChatList() {
    return (
      <>
        <div className="picker-header" dir={lang.isRtl ? 'rtl' : undefined}>
          {renderSearchRow ? renderSearchRow({
            inputRef: searchRef,
            value: search,
            placeholder: searchPlaceholder,
            onChange: handleSearchChange,
            onKeyDown: chatKeyDownHandler,
          }) : (
            <PickerSearchField
              inputRef={searchRef}
              value={search}
              placeholder={searchPlaceholder}
              onChange={handleSearchChange}
              onKeyDown={chatKeyDownHandler}
            />
          )}
          {subheader}
        </div>
        <Transition
          activeKey={listActiveKey || 0}
          name={resolveTransitionName('slideOptimized', animationLevel, shouldSkipHistoryAnimations, lang.isRtl)}
          slideClassName="ChatOrUserPicker_slide"
        >
          <ChatListContent
            isOpen={isOpen}
            viewportIds={viewportIds}
            maxHeight={chatOrUserIds.length * PEER_PICKER_ITEM_HEIGHT_PX}
            viewportFooter={viewportFooter}
            onLoadMore={getMore}
            onSelect={handleChatSelect}
            renderItem={renderChatItem}
            onKeyDownHandlerUpdate={handleKeyDownHandlerUpdate}
          />
        </Transition>
      </>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      hasCloseButton
      headerClassName="modal-header-condensed-wide"
      className={buildClassName('ChatOrUserPicker', className)}
      isLowStackPriority={isLowStackPriority}
      isNativeDialog={isNativeDialog}
      onClose={onClose}
      onCloseAnimationEnd={onCloseAnimationEnd}
    >
      <div className="picker-content">
        {renderChatList()}
      </div>
      {footer}
    </Modal>
  );
};

type ChatListContentProps = {
  isOpen: boolean;
  viewportIds?: string[];
  maxHeight: number;
  viewportFooter?: TeactNode;
  onLoadMore: InfiniteScrollProps['onLoadMore'];
  onSelect: (index: number) => void;
  renderItem: (id: string, index: number) => TeactNode;
  onKeyDownHandlerUpdate: (handler: React.KeyboardEventHandler<HTMLDivElement>) => void;
};

function ChatListContent({
  isOpen,
  viewportIds,
  maxHeight,
  viewportFooter,
  onLoadMore,
  onSelect,
  onKeyDownHandlerUpdate,
  renderItem,
}: ChatListContentProps) {
  const lang = useLang();
  const containerRef = useRef<HTMLDivElement>();

  const handleKeyDown = useKeyboardListNavigation(containerRef, isOpen, onSelect, `.${ITEM_CLASS_NAME}`, true);

  useEffect(() => {
    onKeyDownHandlerUpdate(handleKeyDown);
  }, [handleKeyDown, onKeyDownHandlerUpdate]);

  return (
    <>
      {viewportIds?.length ? (
        <InfiniteScroll
          ref={containerRef}
          className="picker-list custom-scroll"
          items={viewportIds}
          itemSelector={`.${ITEM_CLASS_NAME}`}
          onLoadMore={onLoadMore}
          withAbsolutePositioning
          maxHeight={maxHeight}
          onKeyDown={handleKeyDown}
        >
          {viewportIds.map(renderItem)}
          {Boolean(viewportFooter) && (
            <div key="spacer" className="picker-list-spacer" style={`top: ${maxHeight}px`} />
          )}
        </InfiniteScroll>
      ) : viewportIds && !viewportIds.length ? (
        <p className="no-results">{lang('NothingFound')}</p>
      ) : (
        <Loading />
      )}
    </>
  );
}

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    return {
      animationLevel: selectAnimationLevel(global),
      shouldSkipHistoryAnimations: selectTabState(global).shouldSkipHistoryAnimations,
    };
  },
)(ChatOrUserPicker));
