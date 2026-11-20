import { callApi } from '../../../api/gramjs';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import { updateStarsBalance } from '../../reducers';

addActionHandler('loadStarStatus', async (global): Promise<void> => {
  const [starsBalance, tonBalance] = await Promise.all([
    callApi('fetchStarsStatus'),
    callApi('fetchStarsStatus', { isTon: true }),
  ]);

  global = getGlobal();
  if (starsBalance) global = updateStarsBalance(global, starsBalance);
  if (tonBalance) global = updateStarsBalance(global, tonBalance);
  setGlobal(global);
});
