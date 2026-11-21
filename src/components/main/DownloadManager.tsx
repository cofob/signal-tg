import type { Event } from '@tauri-apps/api/event';
import { memo, useEffect } from '../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../global';

import type { TabState } from '../../global/types';
import type { SavedFilesChange } from '../../util/tauri/nativeFiles';
import { ApiMediaFormat } from '../../api/types';

import { selectTabState } from '../../global/selectors';
import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { IS_OPFS_SUPPORTED, IS_SERVICE_WORKER_SUPPORTED, MAX_BUFFER_SIZE } from '../../util/browser/windowEnvironment';
import download from '../../util/download';
import generateUniqueId from '../../util/generateUniqueId';
import * as mediaLoader from '../../util/mediaLoader';
import { loadSavedFiles } from '../../util/tauri/nativeFiles';

import useTauriEvent from '../../hooks/tauri/useTauriEvent';
import useLastCallback from '../../hooks/useLastCallback';
import useRunDebounced from '../../hooks/useRunDebounced';

type StateProps = {
  activeDownloads: TabState['activeDownloads'];
};

const GLOBAL_UPDATE_DEBOUNCE = 1000;

const processedHashes = new Set<string>();
const downloadedHashes = new Set<string>();

const DownloadManager = ({
  activeDownloads,
}: StateProps) => {
  const { cancelMediaHashDownloads, showNotification, updateSavedFiles } = getActions();

  const runDebounced = useRunDebounced(GLOBAL_UPDATE_DEBOUNCE, true);

  const handleMediaDownloaded = useLastCallback((hash: string) => {
    downloadedHashes.add(hash);
    runDebounced(() => {
      if (downloadedHashes.size) {
        cancelMediaHashDownloads({ mediaHashes: Array.from(downloadedHashes) });
        downloadedHashes.clear();
      }
    });
  });

  // The desktop app tells every window when it saves a file or finds one gone
  const handleSavedFilesChange = useLastCallback((event: Event<SavedFilesChange>) => {
    updateSavedFiles(event.payload);
  });
  useTauriEvent('saved-files-changed', handleSavedFilesChange);

  useEffect(() => {
    if (IS_TAURI) {
      loadSavedFiles().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!Object.keys(activeDownloads).length) {
      processedHashes.clear();
      return;
    }

    Object.entries(activeDownloads).forEach(([mediaHash, metadata]) => {
      if (processedHashes.has(mediaHash)) {
        return;
      }
      processedHashes.add(mediaHash);

      const { size, filename, format: mediaFormat } = metadata;

      const mediaData = mediaLoader.getFromMemory(mediaHash);

      if (mediaData) {
        download(mediaData, filename, mediaHash);
        handleMediaDownloaded(mediaHash);
        return;
      }

      if (size > MAX_BUFFER_SIZE && !IS_OPFS_SUPPORTED && !IS_SERVICE_WORKER_SUPPORTED) {
        showNotification({
          message: { key: 'DownloadSizeUnsupported' },
        });
        handleMediaDownloaded(mediaHash);
        return;
      }

      const handleProgress = () => {
        const currentDownloads = selectTabState(getGlobal()).activeDownloads;
        if (!currentDownloads[mediaHash]) {
          mediaLoader.cancelProgress(handleProgress);
        }
      };

      mediaLoader.fetch(mediaHash, mediaFormat, handleProgress, generateUniqueId()).then(async (result) => {
        if (mediaFormat === ApiMediaFormat.DownloadUrl) {
          const url = new URL(result, window.document.baseURI);
          url.searchParams.set('filename', encodeURIComponent(filename));
          const signedUrl = await mediaLoader.signDownloadUrl(url.toString());
          const downloadWindow = signedUrl ? window.open(signedUrl) : undefined;

          downloadWindow?.addEventListener('beforeunload', () => {
            showNotification({
              message: { key: 'DownloadKeepAppOpen' },
            });
          }, { once: true });
        } else if (result) {
          download(result, filename, mediaHash);
        }

        handleMediaDownloaded(mediaHash);
      });
    });
  }, [activeDownloads]);

  return undefined;
};

export default memo(withGlobal(
  (global): Complete<StateProps> => {
    const activeDownloads = selectTabState(global).activeDownloads;

    return {
      activeDownloads,
    };
  },
)(DownloadManager));
