import type { ActionReturnType } from '../../types';

import { addActionHandler, setGlobal } from '../../index';
import { updateStarsBalance } from '../../reducers';

addActionHandler('apiUpdate', (global, actions, update): ActionReturnType => {
  switch (update['@type']) {
    case 'updateStarsBalance': {
      global = updateStarsBalance(global, update.balance);
      setGlobal(global);
      break;
    }
  }
});
