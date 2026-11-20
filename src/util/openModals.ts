import { createSignal } from './signals';

// Counted by both modal implementations; a widget drops its actions while any modal is open
const [getOpenModalCount, setOpenModalCount] = createSignal(0);

export { getOpenModalCount };

export function countOpenModal() {
  setOpenModalCount(getOpenModalCount() + 1);

  return () => {
    setOpenModalCount(Math.max(0, getOpenModalCount() - 1));
  };
}
