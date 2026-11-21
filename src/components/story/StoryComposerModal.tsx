import type { ChangeEvent } from 'react';
import {
  memo, useEffect, useMemo, useRef, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type {
  ApiAttachment, ApiChat, ApiStoryDistributionList, ApiTextStoryStyle,
} from '../../api/types';
import type { TabState } from '../../global/types';
import type { IRadioOption } from '../ui/CheckboxGroup';

import { SUPPORTED_PHOTO_CONTENT_TYPES, SUPPORTED_VIDEO_CONTENT_TYPES } from '../../config';
import buildClassName from '../../util/buildClassName';
import { getStoryBackgroundCss, STORY_BACKGROUNDS } from '../../util/storyBackgrounds';
import buildAttachment from '../middle/composer/helpers/buildAttachment';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import CheckboxGroup from '../ui/CheckboxGroup';
import InputText from '../ui/InputText';
import Modal from '../ui/Modal';
import { getTextSizeClassName, getTextStyleClassName } from './TextStory';

import styles from './StoryComposerModal.module.scss';

export type OwnProps = {
  modal: TabState['storyComposerModal'];
};

type StateProps = {
  distributionLists?: ApiStoryDistributionList[];
  chatsById: Record<string, ApiChat>;
  orderedChatIds?: string[];
};

type Mode = 'text' | 'media';

const TEXT_STYLES: ApiTextStoryStyle[] = ['default', 'bold', 'serif', 'script', 'condensed'];
const BACKGROUNDS = STORY_BACKGROUNDS.map(getStoryBackgroundCss);
// Signal Android `StoryTextPostView`: text stories take up to 700 characters
const MAX_TEXT_LENGTH = 700;
const SUPPORTED_STORY_MEDIA_TYPES = new Set([...SUPPORTED_PHOTO_CONTENT_TYPES, ...SUPPORTED_VIDEO_CONTENT_TYPES]);
const MEDIA_ACCEPT = [...SUPPORTED_STORY_MEDIA_TYPES].join(',');

/**
 * Composes a Signal story: text on a preset background in one of the story fonts, or a photo or video with a caption,
 * sent to My Story, custom distribution lists and groups (Signal Desktop `StoryCreator.dom.tsx`)
 */
const StoryComposerModal = ({
  modal,
  distributionLists,
  chatsById,
  orderedChatIds,
}: OwnProps & StateProps) => {
  const {
    closeStoryComposer, sendStory, loadStoryDistributionLists, showNotification,
  } = getActions();

  const lang = useLang();
  const isOpen = Boolean(modal);
  const isSending = Boolean(modal?.isSending);
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [textStyle, setTextStyle] = useState<ApiTextStoryStyle>('default');
  const [backgroundIndex, setBackgroundIndex] = useState(0);
  const [attachment, setAttachment] = useState<ApiAttachment | undefined>();
  const [caption, setCaption] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>();
  const isDefaultAudienceSelectedRef = useRef(false);

  useEffect(() => {
    isDefaultAudienceSelectedRef.current = false;
    if (!isOpen) return;
    loadStoryDistributionLists();
    setMode('text');
    setText('');
    setCaption('');
    setAttachment(undefined);
    setSelectedIds([]);
  }, [isOpen]);

  const myStoryId = distributionLists?.find(({ isMyStory }) => isMyStory)?.id;
  useEffect(() => {
    // My Story is selected once per composer, so the person can clear it
    if (!isOpen || !myStoryId || isDefaultAudienceSelectedRef.current) return;
    isDefaultAudienceSelectedRef.current = true;
    setSelectedIds((ids) => (ids.length ? ids : [myStoryId]));
  }, [isOpen, myStoryId]);

  const audienceOptions = useMemo((): IRadioOption[] => {
    const listOptions = (distributionLists ?? []).map((list) => ({
      value: list.id,
      label: list.isMyStory ? lang('StoryRibbonMyStory') : list.name,
      subLabel: getListDescription(lang, list),
    }));
    const groupOptions = (orderedChatIds ?? [])
      .map((id) => chatsById[id])
      .filter((chat) => chat?.type === 'chatTypeBasicGroup' && !chat.isForbidden && !chat.isNotJoined)
      .map((chat) => ({ value: chat.id, label: chat.title, subLabel: lang('StoryGroupStory') }));
    return [...listOptions, ...groupOptions];
  }, [chatsById, distributionLists, lang, orderedChatIds]);

  const listIds = useMemo(() => new Set(distributionLists?.map(({ id }) => id)), [distributionLists]);
  const canSend = Boolean(!isSending && selectedIds.length && (mode === 'text' ? text.trim() : attachment));

  const handleFileChange = useLastCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;

    try {
      const built = await buildAttachment(file.name, file);
      if (SUPPORTED_STORY_MEDIA_TYPES.has(built.mimeType)) {
        setAttachment(built);
      } else {
        showNotification({ message: { key: 'StoryMediaUnsupported' } });
      }
    } catch {
      showNotification({ message: { key: 'StoryMediaUnsupported' } });
    }
  });

  const handleChooseFile = useLastCallback(() => {
    fileInputRef.current?.click();
  });

  const handleTextChange = useLastCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.currentTarget.value.slice(0, MAX_TEXT_LENGTH));
  });

  const handleCaptionChange = useLastCallback((e: ChangeEvent<HTMLInputElement>) => {
    setCaption(e.currentTarget.value);
  });

  const handleSend = useLastCallback(() => {
    if (!canSend) return;
    sendStory({
      story: mode === 'text'
        ? { text: { text: text.trim() }, textStyle, backgroundIndex }
        : { attachment, caption: caption.trim() ? { text: caption.trim() } : undefined },
      listIds: selectedIds.filter((id) => listIds.has(id)),
      groupIds: selectedIds.filter((id) => !listIds.has(id)),
    });
  });

  const handleClose = useLastCallback(() => {
    closeStoryComposer();
  });

  function renderTextEditor() {
    return (
      <>
        <div className={styles.preview} style={`background: ${BACKGROUNDS[backgroundIndex]}`}>
          <textarea
            className={buildClassName(
              styles.textInput, getTextStyleClassName(textStyle), getTextSizeClassName(text),
            )}
            value={text}
            placeholder={lang('StoryTextPlaceholder')}
            dir="auto"
            onChange={handleTextChange}
          />
        </div>
        <div className={styles.swatches}>
          {BACKGROUNDS.map((background, index) => (
            <button
              key={background}
              type="button"
              className={buildClassName(styles.swatch, index === backgroundIndex && styles.selected)}
              style={`background: ${background}`}
              aria-label={lang('StoryBackground', { index: index + 1 })}
              onClick={() => setBackgroundIndex(index)}
            />
          ))}
        </div>
        <div className={styles.fonts}>
          {TEXT_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              className={buildClassName(
                styles.font, getTextStyleClassName(style), style === textStyle && styles.selected,
              )}
              onClick={() => setTextStyle(style)}
            >
              Aa
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderMediaEditor() {
    const isVideo = attachment?.mimeType.startsWith('video/');
    return (
      <>
        <div className={buildClassName(styles.preview, styles.mediaPreview)} onClick={handleChooseFile}>
          {!attachment && <span className={styles.mediaHint}>{lang('StoryChooseMedia')}</span>}
          {attachment && !isVideo && <img className={styles.media} src={attachment.blobUrl} alt="" draggable={false} />}
          {attachment && isVideo && (
            <video className={styles.media} src={attachment.blobUrl} autoPlay muted loop playsInline />
          )}
        </div>
        <InputText
          className={styles.caption}
          value={caption}
          label={lang('StoryCaption')}
          onChange={handleCaptionChange}
        />
        <input
          ref={fileInputRef}
          type="file"
          className={styles.fileInput}
          accept={MEDIA_ACCEPT}
          onChange={handleFileChange}
        />
      </>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      title={lang('StoryNew')}
      hasCloseButton
      className={styles.root}
      contentClassName={styles.content}
      onClose={handleClose}
    >
      <div className={styles.modes}>
        <Button
          size="smaller"
          color={mode === 'text' ? 'primary' : 'secondary'}
          onClick={() => setMode('text')}
        >
          {lang('StoryModeText')}
        </Button>
        <Button
          size="smaller"
          color={mode === 'media' ? 'primary' : 'secondary'}
          onClick={() => setMode('media')}
        >
          {lang('StoryModeMedia')}
        </Button>
      </div>
      {mode === 'text' ? renderTextEditor() : renderMediaEditor()}
      <h4 className={styles.audienceTitle}>{lang('StorySendTo')}</h4>
      <CheckboxGroup options={audienceOptions} selected={selectedIds} onChange={setSelectedIds} />
      <Button className={styles.send} disabled={!canSend} onClick={handleSend}>
        {lang('StorySend')}
      </Button>
    </Modal>
  );
};

function getListDescription(lang: ReturnType<typeof useLang>, list: ApiStoryDistributionList) {
  const count = list.memberIds.length;
  if (list.isMyStory) {
    if (list.isBlockList) {
      return count
        ? lang('StoryMyStoryExcept', { count }, { pluralValue: count })
        : lang('StoryMyStoryAllConnections');
    }
    return lang('StoryMyStoryOnly', { count }, { pluralValue: count });
  }
  return lang('StoryListMembers', { count }, { pluralValue: count });
}

export default memo(withGlobal<OwnProps>((global): Complete<StateProps> => {
  return {
    distributionLists: global.stories.distributionLists,
    chatsById: global.chats.byId,
    orderedChatIds: global.chats.listIds.active,
  };
})(StoryComposerModal));
