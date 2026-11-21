import { memo, useMemo } from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type {
  ApiMessage, ApiPhoto, ApiVideo, MediaContent,
} from '../../../api/types';
import type { GlobalState, TabState } from '../../../global/types';
import type { ObserveFn } from '../../../hooks/useIntersectionObserver';
import type { IAlbum, ThemeKey } from '../../../types';

import {
  getIsDownloading, getMediaDimensions, getMessageContent, getMessageHtmlId, getMessagePhoto,
} from '../../../global/helpers';
import {
  selectActiveDownloads,
  selectCanAutoLoadMedia,
  selectCanAutoPlayMedia,
  selectTheme,
} from '../../../global/selectors';
import { getMessageKey } from '../../../util/keys/messageKey';
import { AlbumRectPart, calculateAlbumLayout } from './helpers/calculateAlbumLayout';
import withSelectControl from './hocs/withSelectControl';

import useLastCallback from '../../../hooks/useLastCallback';

import AlbumItem from './AlbumItem';
import Photo from './Photo';
import Video from './Video';

import './Album.scss';

const PhotoWithSelect = withSelectControl(Photo);
const VideoWithSelect = withSelectControl(Video);

type OwnProps = {
  album: IAlbum;
  observeIntersection: ObserveFn;
  hasCustomAppendix?: boolean;
  isOwn: boolean;
  isProtected?: boolean;
  onMediaClick: (messageId: number, index?: number) => void;
};

type AlbumMediaItem = Pick<MediaContent, 'photo' | 'video'> & { message: ApiMessage };

type StateProps = {
  theme: ThemeKey;
  uploadsByKey: GlobalState['fileUploads']['byMessageKey'];
  activeDownloads: TabState['activeDownloads'];
};

const Album = ({
  album,
  observeIntersection,
  hasCustomAppendix,
  isOwn,
  isProtected,
  onMediaClick,
  uploadsByKey,
  activeDownloads,
  theme,
}: OwnProps & StateProps) => {
  const { cancelUploadMedia } = getActions();

  const items = useMemo(() => getAlbumItems(album), [album]);
  const mediaCount = items.length;

  const handleAlbumMessageClick = useLastCallback((messageId: number) => {
    onMediaClick(messageId);
  });

  const handleAlbumIndexClick = useLastCallback((index: number) => {
    onMediaClick(album.mainMessage.id, index);
  });

  const handleCancelUpload = useLastCallback((messageId: number) => {
    cancelUploadMedia({ chatId: album.mainMessage.chatId, messageId });
  });

  const albumLayout = useMemo(() => {
    const ratios = getAlbumMedia(items).map((media) => {
      const { width, height } = getMediaDimensions(media);
      return width / height;
    });

    return calculateAlbumLayout(ratios);
  }, [items]);

  function renderAlbumItem({ message, photo, video }: AlbumMediaItem, index: number) {
    const { isSingleMessage } = album;
    const htmlId = `album-media-${getMessageHtmlId(message.id, isSingleMessage ? index : undefined)}`;

    const fileUpload = uploadsByKey[getMessageKey(message)];
    const uploadProgress = fileUpload?.progress;
    const layoutItem = albumLayout.items[index];
    const { sides } = layoutItem;

    // Ignoring global updates is a known drawback here
    const canAutoLoad = selectCanAutoLoadMedia(getGlobal(), message);
    const canAutoPlay = selectCanAutoPlayMedia(getGlobal(), message);
    let mediaElement;

    if (photo) {
      const shouldAffectAppendix = hasCustomAppendix && (

        (isOwn ? index === mediaCount - 1 : Boolean(sides & AlbumRectPart.Left && sides & AlbumRectPart.Bottom))
      );

      mediaElement = (
        <PhotoWithSelect
          id={htmlId}
          photo={photo}
          isOwn={isOwn}
          observeIntersection={observeIntersection}
          canAutoLoad={canAutoLoad}
          shouldAffectAppendix={shouldAffectAppendix}
          uploadProgress={uploadProgress}
          layout="fill"
          isProtected={isProtected}
          clickArg={isSingleMessage ? index : message.id}
          onClick={isSingleMessage ? handleAlbumIndexClick : handleAlbumMessageClick}
          onCancelUpload={handleCancelUpload}
          isDownloading={getIsDownloading(activeDownloads, photo)}
          theme={theme}
        />
      );
    } else if (video) {
      mediaElement = (
        <VideoWithSelect
          id={htmlId}
          video={video}
          observeIntersectionForLoading={observeIntersection}
          canAutoLoad={canAutoLoad}
          canAutoPlay={canAutoPlay}
          uploadProgress={uploadProgress}
          layout="fill"
          isProtected={isProtected}
          clickArg={isSingleMessage ? index : message.id}
          onClick={isSingleMessage ? handleAlbumIndexClick : handleAlbumMessageClick}
          onCancelUpload={handleCancelUpload}
          isDownloading={getIsDownloading(activeDownloads, video)}
        />
      );
    }

    if (!mediaElement) return undefined;

    return (
      <AlbumItem
        key={isSingleMessage ? index : message.id}
        item={layoutItem}
        className="album-item"
      >
        {mediaElement}
      </AlbumItem>
    );
  }

  return (
    <div
      className="Album"
      style={`--album-aspect-ratio: ${albumLayout.aspectRatio}`}
    >
      {items.map(renderAlbumItem)}
    </div>
  );
};

type AlbumMedia = ApiPhoto | ApiVideo;

function getAlbumItems(album: IAlbum): AlbumMediaItem[] {
  const { mainMessage, isSingleMessage } = album;
  if (isSingleMessage) return mainMessage.content.album!.items.map((item) => ({ ...item, message: mainMessage }));

  return album.messages.map((message) => ({
    message, photo: getMessagePhoto(message), video: getMessageContent(message).video,
  }));
}

function getAlbumMedia(items: AlbumMediaItem[]) {
  const media = items.map(({ photo, video }) => photo || video);

  return media.filter((item): item is AlbumMedia => Boolean(item));
}

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const theme = selectTheme(global);
    const activeDownloads = selectActiveDownloads(global);

    return {
      theme,
      uploadsByKey: global.fileUploads.byMessageKey,
      activeDownloads,
    };
  },
)(Album));
