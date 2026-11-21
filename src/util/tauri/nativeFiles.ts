import { invoke } from '@tauri-apps/api/core';
import { getActions, getGlobal } from '../../global';

import type { RegularLangKey } from '../../types/language';

import { selectSharedSettings } from '../../global/selectors/sharedState';
import { IS_MAC_OS, IS_WINDOWS } from '../browser/windowEnvironment';
import { fetchBlob } from '../files';
import generateUniqueId from '../generateUniqueId';
import { getTranslationFn } from '../localization';

type SavedFileInfo = {
  fileName: string;
  folderName: string;
};

type SavedFileOutcome = 'done' | 'missing' | 'cancelled';

export type SavedFilesChange = {
  added: string[];
  removed: string[];
};

// The desktop app writes the chunks into the file as they arrive (`tauri/src/files.rs`)
const CHUNK_BYTES = 2 * 1024 * 1024;
const SAVE_ID_HEADER = 'save-id';
const SAVED_NOTIFICATION_DURATION_MS = 8000;

/**
 * Saves the file that a blob URL holds through the desktop app, which picks the destination: the
 * Downloads folder, or a path from a save dialog when the setting asks for one. `key` names the file
 * for the actions that follow, such as `openSavedFile`; it is the media hash for attachments.
 */
export async function saveFile(url: string, fileName: string, key = generateUniqueId()) {
  const { shouldAskWhereToSave } = selectSharedSettings(getGlobal());
  const lang = getTranslationFn();

  let saveId: number | undefined;
  try {
    saveId = await invoke<number | null>('begin_file_save', {
      fileName,
      key,
      shouldAskWhere: shouldAskWhereToSave,
      dialogTitle: lang('FileSaveDialogTitle'),
    }) ?? undefined;
    // The user canceled the save dialog
    if (saveId === undefined) return;

    const blob = await fetchBlob(url);
    for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
      const chunk = await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
      // Chunks go one at a time, which keeps their order
      await invoke('write_file_chunk', chunk, { headers: { [SAVE_ID_HEADER]: String(saveId) } });
    }

    const { fileName: savedName, folderName } = await invoke<SavedFileInfo>('finish_file_save', { id: saveId });
    getActions().showNotification({
      message: { key: 'FileSaved', variables: { fileName: savedName, folder: folderName } },
      icon: 'download',
      duration: SAVED_NOTIFICATION_DURATION_MS,
      actionText: { key: 'Open' },
      action: { action: 'openSavedFile', payload: { key } },
      secondaryActionText: { key: getShowInFolderLangKey() },
      secondaryAction: { action: 'showSavedFileInFolder', payload: { key } },
    });
  } catch (err) {
    if (saveId !== undefined) {
      invoke('abort_file_save', { id: saveId }).catch(() => undefined);
    }
    // eslint-disable-next-line no-console
    console.error('Failed to save file:', err);
    getActions().showNotification({ message: { key: 'NativeDownloadFailed' } });
  }
}

/** Opens a saved file with the default app; the app confirms first when the file type is dangerous */
export async function openSavedFile(key: string, tabId?: number) {
  const lang = getTranslationFn();
  try {
    const outcome = await invoke<SavedFileOutcome>('open_saved_file', {
      key,
      prompt: {
        title: lang('FileOpenDangerousTitle'),
        message: lang('FileOpenDangerousText'),
        openLabel: lang('Open'),
        cancelLabel: lang('Cancel'),
      },
    });
    handleOutcome(outcome, tabId);
  } catch (err) {
    handleFailure(err, tabId);
  }
}

/** Shows a saved file in Finder, Explorer or the file manager */
export async function revealSavedFile(key: string, tabId?: number) {
  try {
    handleOutcome(await invoke<SavedFileOutcome>('reveal_saved_file', { key }), tabId);
  } catch (err) {
    handleFailure(err, tabId);
  }
}

/** Loads the keys of the files that the app saved and that still exist */
export async function loadSavedFiles() {
  const keys = await invoke<string[]>('list_saved_files');
  getActions().updateSavedFiles({ added: keys });
}

export function getShowInFolderLangKey(): RegularLangKey {
  if (IS_MAC_OS) return 'FileShowInFinder';
  return IS_WINDOWS ? 'FileShowInExplorer' : 'FileShowInFolder';
}

function handleOutcome(outcome: SavedFileOutcome, tabId?: number) {
  // The app dropped the record of a missing file, which the page learns from its event
  if (outcome === 'missing') {
    getActions().showNotification({ message: { key: 'FileNotFound' }, tabId });
  }
}

function handleFailure(err: unknown, tabId?: number) {
  // eslint-disable-next-line no-console
  console.error('Failed to open file:', err);
  getActions().showNotification({ message: { key: 'FileOpenFailed' }, tabId });
}
