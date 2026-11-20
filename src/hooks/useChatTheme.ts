import type { ElementRef } from '../lib/teact/teact';
import { useLayoutEffect, useMemo, useRef } from '../lib/teact/teact';

import type { ApiThemeSettings } from '../api/types';
import type { ThemeKey } from '../types';
import type { ThemePalette } from '../util/theme';

import { selectIsSignalTheme } from '../global/selectors';
import { applyThemeStyle, hasActiveThemeTransition } from '../util/switchTheme';
import { buildThemePalette, isThemePaletteTransitionSafe } from '../util/theme';
import useSelector from './data/useSelector';

export default function useChatTheme(
  containerRef: ElementRef<HTMLDivElement>,
  chatId: string | undefined,
  theme: ThemeKey,
  settings?: ApiThemeSettings,
  canAnimate?: boolean,
  serviceBackground?: string,
) {
  const isSignalTheme = useSelector(selectIsSignalTheme);
  const palette = buildThemePalette(theme, settings, isSignalTheme);
  const variables = useMemo(() => serviceBackground
    ? { ...palette.variables, '--action-message-bg': serviceBackground } : palette.variables,
  [palette, serviceBackground]);
  const previousPaletteRef = useRef<ThemePalette>();
  const previousChatIdRef = useRef<string>();
  const shouldSnapColors = useMemo(() => {
    const previousPalette = previousPaletteRef.current;
    return previousChatIdRef.current !== chatId
      || !previousPalette || !canAnimate || hasActiveThemeTransition(containerRef.current)
      || !isThemePaletteTransitionSafe(previousPalette, palette);
  }, [containerRef, chatId, palette, canAnimate]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    applyThemeStyle(container, variables, canAnimate && previousChatIdRef.current === chatId, shouldSnapColors);
    previousPaletteRef.current = palette;
    previousChatIdRef.current = chatId;
  }, [containerRef, chatId, palette, variables, canAnimate, shouldSnapColors]);

  return { palette, shouldSnapColors };
}
