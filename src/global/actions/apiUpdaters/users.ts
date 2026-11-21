import { throttleWithFullyIdle } from '../../../lib/teact/heavyAnimation';

import type { ApiUserStatus } from '../../../api/types';
import type { ActionReturnType } from '../../types';

import { addActionHandler, getGlobal, setGlobal } from '../../index';
import {
  deleteContact,
  replaceUserStatuses,
  updateChat,
  updatePeerFullInfo,
  updatePeerStoriesHidden,
  updateUser,
  updateUserFullInfo,
} from '../../reducers';
import {
  selectPeerFullInfo,
  selectUser, selectUserFullInfo,
} from '../../selectors';

const updateStatusesOnFullyIdle = throttleWithFullyIdle(flushStatusUpdates);

let pendingStatusUpdates: Record<string, ApiUserStatus> = {};

function flushStatusUpdates() {
  let global = getGlobal();

  global = replaceUserStatuses(global, {
    ...global.users.statusesById,
    ...pendingStatusUpdates,
  });
  setGlobal(global);

  pendingStatusUpdates = {};
}

addActionHandler('apiUpdate', (global, actions, update): ActionReturnType => {
  switch (update['@type']) {
    case 'deleteContact': {
      return deleteContact(global, update.id);
    }

    case 'updateUser': {
      const localUser = selectUser(global, update.id);

      global = updateUser(global, update.id, update.user);
      if (update.fullInfo) {
        global = updateUserFullInfo(global, update.id, update.fullInfo);
      }

      if (localUser?.areStoriesHidden !== update.user.areStoriesHidden) {
        global = updatePeerStoriesHidden(global, update.id, update.user.areStoriesHidden || false);
      }

      return global;
    }

    case 'updateRequestUserUpdate': {
      actions.loadFullUser({ userId: update.id });
      break;
    }

    case 'updateUserStatus': {
      // Status updates come very often so we throttle them
      pendingStatusUpdates[update.userId] = update.status;
      updateStatusesOnFullyIdle();
      return undefined;
    }

    case 'updateUserFullInfo': {
      const { id, fullInfo } = update;

      return updateUserFullInfo(global, id, fullInfo);
    }

    case 'updatePeerSettings': {
      const { id, settings } = update;

      const targetUserFullInfo = selectUserFullInfo(global, id);
      if (!targetUserFullInfo) {
        actions.loadFullUser({ userId: id });
        return undefined;
      }

      global = updateUserFullInfo(global, id, {
        settings,
      });
      return global;
    }

    case 'updatePeerHistoryTtl': {
      const { id, ttlPeriod } = update;

      global = updateChat(global, id, { ttlPeriod });

      const fullInfo = selectPeerFullInfo(global, id);
      if (!fullInfo) return global;

      return updatePeerFullInfo(global, id, { ttlPeriod });
    }
  }

  return undefined;
});
