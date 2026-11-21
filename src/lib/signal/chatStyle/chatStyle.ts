import type { ChatStyle, ChatStyle_CustomChatColor } from '../proto/generated/Backup_pb';

import {
  ChatStyle_BubbleColorPreset as BubblePreset,
  ChatStyle_WallpaperPreset as WallpaperPreset,
} from '../proto/generated/Backup_pb';

/**
 * Chat colors and wallpapers of Signal. They are not in the storage service: a linked device gets them from the
 * history that the primary device transfers when linking (`Backup.proto` `ChatStyle`), as Signal Desktop does in
 * `ts/services/backups/import.preload.ts`, and keeps them for display. The colors of the presets are those of Signal
 * Desktop `ts/axo/AxoTokens.std.ts` (bubbles) and Signal Android `GradientChatWallpaper` and `SingleColorChatWallpaper`
 * (wallpapers; their gradients have 16 stops, of which the first and last are kept).
 */

/** The style of a chat, or the default one of the account; the numbers are the proto enum values */
export type ChatStyleRecord = {
  wallpaperPreset?: number;
  bubbleColorPreset?: number;
  // The id of a custom chat color of the account
  customColorId?: string;
};

export type CustomChatColorRecord = {
  solid?: number;
  gradient?: { angle: number; colors: number[]; positions: number[] };
};

/** What the app shows of a style: CSS backgrounds */
export type ChatStyleColors = {
  bubble?: string;
  wallpaper?: string;
};

const DEGREES_180 = 180;
const COLOR_MASK = 0xffffff;
const HEX_RADIX = 16;
const COLOR_DIGITS = 6;
const PERCENT = 100;

const BUBBLE_COLORS: Record<number, string> = {
  [BubblePreset.SOLID_ULTRAMARINE]: gradient(DEGREES_180, '#0552f0', '#2c6bed'),
  [BubblePreset.SOLID_CRIMSON]: '#cf163e',
  [BubblePreset.SOLID_VERMILION]: '#c73f0a',
  [BubblePreset.SOLID_BURLAP]: '#6f6a58',
  [BubblePreset.SOLID_FOREST]: '#3b7845',
  [BubblePreset.SOLID_WINTERGREEN]: '#1d8663',
  [BubblePreset.SOLID_TEAL]: '#077d92',
  [BubblePreset.SOLID_BLUE]: '#336ba3',
  [BubblePreset.SOLID_INDIGO]: '#6058ca',
  [BubblePreset.SOLID_VIOLET]: '#9932c8',
  [BubblePreset.SOLID_PLUM]: '#aa377a',
  [BubblePreset.SOLID_TAUPE]: '#8f616a',
  [BubblePreset.SOLID_STEEL]: '#71717f',
  [BubblePreset.GRADIENT_EMBER]: gradient(168, '#e57c00', '#5e0000'),
  [BubblePreset.GRADIENT_MIDNIGHT]: gradient(DEGREES_180, '#2c2c3a', '#787891'),
  [BubblePreset.GRADIENT_INFRARED]: gradient(192, '#f65560', '#442ced'),
  [BubblePreset.GRADIENT_LAGOON]: gradient(DEGREES_180, '#004066', '#32867d'),
  [BubblePreset.GRADIENT_FLUORESCENT]: gradient(192, '#ec13dd', '#1b36c6'),
  [BubblePreset.GRADIENT_BASIL]: gradient(DEGREES_180, '#2f9373', '#077343'),
  [BubblePreset.GRADIENT_SUBLIME]: gradient(DEGREES_180, '#6281d5', '#974460'),
  [BubblePreset.GRADIENT_SEA]: gradient(DEGREES_180, '#498fd4', '#2c66a0'),
  [BubblePreset.GRADIENT_TANGERINE]: gradient(192, '#db7133', '#911231'),
};

const WALLPAPER_COLORS: Record<number, string> = {
  [WallpaperPreset.SOLID_BLUSH]: '#e26983',
  [WallpaperPreset.SOLID_COPPER]: '#df9171',
  [WallpaperPreset.SOLID_DUST]: '#9e9887',
  [WallpaperPreset.SOLID_CELADON]: '#89ae8f',
  [WallpaperPreset.SOLID_RAINFOREST]: '#146148',
  [WallpaperPreset.SOLID_PACIFIC]: '#32c7e2',
  [WallpaperPreset.SOLID_FROST]: '#7c99b6',
  [WallpaperPreset.SOLID_NAVY]: '#403b91',
  [WallpaperPreset.SOLID_LILAC]: '#c988e7',
  [WallpaperPreset.SOLID_PINK]: '#e297c3',
  [WallpaperPreset.SOLID_EGGPLANT]: '#624249',
  [WallpaperPreset.SOLID_SILVER]: '#a2a2aa',
  [WallpaperPreset.GRADIENT_SUNSET]: gradient(168, '#f3dc47', '#e44040'),
  [WallpaperPreset.GRADIENT_NOIR]: gradient(DEGREES_180, '#16161d', '#6e6e87'),
  [WallpaperPreset.GRADIENT_HEATMAP]: gradient(192, '#f53844', '#42378f'),
  [WallpaperPreset.GRADIENT_AQUA]: gradient(DEGREES_180, '#0093e9', '#80d0c7'),
  [WallpaperPreset.GRADIENT_IRIDESCENT]: gradient(192, '#f04ce6', '#0e2fdd'),
  [WallpaperPreset.GRADIENT_MONSTERA]: gradient(DEGREES_180, '#65cdac', '#0a995a'),
  [WallpaperPreset.GRADIENT_BLISS]: gradient(DEGREES_180, '#d8e1fa', '#d6a4b5'),
  [WallpaperPreset.GRADIENT_SKY]: gradient(DEGREES_180, '#d8ebfd', '#9dccfb'),
  [WallpaperPreset.GRADIENT_PEACH]: gradient(192, '#ffe5c2', '#fcac92'),
};

// The bubble color that goes with a wallpaper while the bubble color is automatic (Desktop
// `WALLPAPER_TO_BUBBLE_COLOR` in `ts/services/backups/constants.std.ts`)
const AUTO_BUBBLE_COLORS: Record<number, number> = {
  [WallpaperPreset.SOLID_BLUSH]: BubblePreset.SOLID_CRIMSON,
  [WallpaperPreset.SOLID_COPPER]: BubblePreset.SOLID_VERMILION,
  [WallpaperPreset.SOLID_DUST]: BubblePreset.SOLID_BURLAP,
  [WallpaperPreset.SOLID_CELADON]: BubblePreset.SOLID_FOREST,
  [WallpaperPreset.SOLID_RAINFOREST]: BubblePreset.SOLID_WINTERGREEN,
  [WallpaperPreset.SOLID_PACIFIC]: BubblePreset.SOLID_TEAL,
  [WallpaperPreset.SOLID_FROST]: BubblePreset.SOLID_BLUE,
  [WallpaperPreset.SOLID_NAVY]: BubblePreset.SOLID_INDIGO,
  [WallpaperPreset.SOLID_LILAC]: BubblePreset.SOLID_VIOLET,
  [WallpaperPreset.SOLID_PINK]: BubblePreset.SOLID_PLUM,
  [WallpaperPreset.SOLID_EGGPLANT]: BubblePreset.SOLID_TAUPE,
  [WallpaperPreset.SOLID_SILVER]: BubblePreset.SOLID_STEEL,
  [WallpaperPreset.GRADIENT_SUNSET]: BubblePreset.GRADIENT_EMBER,
  [WallpaperPreset.GRADIENT_NOIR]: BubblePreset.GRADIENT_MIDNIGHT,
  [WallpaperPreset.GRADIENT_HEATMAP]: BubblePreset.GRADIENT_INFRARED,
  [WallpaperPreset.GRADIENT_AQUA]: BubblePreset.GRADIENT_LAGOON,
  [WallpaperPreset.GRADIENT_IRIDESCENT]: BubblePreset.GRADIENT_FLUORESCENT,
  [WallpaperPreset.GRADIENT_MONSTERA]: BubblePreset.GRADIENT_BASIL,
  [WallpaperPreset.GRADIENT_BLISS]: BubblePreset.GRADIENT_SUBLIME,
  [WallpaperPreset.GRADIENT_SKY]: BubblePreset.GRADIENT_SEA,
  [WallpaperPreset.GRADIENT_PEACH]: BubblePreset.GRADIENT_TANGERINE,
};

/** The style of a backup, `undefined` when it sets nothing (and so the default style applies) */
export function buildChatStyleRecord(style?: ChatStyle): ChatStyleRecord | undefined {
  if (!style) return undefined;

  // A wallpaper photo is not kept: it is a file of the backup, which this device does not download
  const wallpaperPreset = style.wallpaper.case === 'wallpaperPreset' && style.wallpaper.value
    ? style.wallpaper.value
    : undefined;
  const { bubbleColor } = style;
  const bubbleColorPreset = bubbleColor.case === 'bubbleColorPreset' && bubbleColor.value
    ? bubbleColor.value
    : undefined;
  const customColorId = bubbleColor.case === 'customColorId' ? String(bubbleColor.value) : undefined;
  if (!wallpaperPreset && !bubbleColorPreset && !customColorId) return undefined;
  return { wallpaperPreset, bubbleColorPreset, customColorId };
}

export function buildCustomChatColors(colors: ChatStyle_CustomChatColor[]) {
  const result: Record<string, CustomChatColorRecord> = {};
  for (const { id, color } of colors) {
    if (color.case === 'solid') {
      result[String(id)] = { solid: color.value };
    } else if (color.case === 'gradient') {
      result[String(id)] = {
        gradient: { angle: color.value.angle, colors: color.value.colors, positions: color.value.positions },
      };
    }
  }
  return result;
}

/**
 * The colors of a chat: its own style where it sets one, else the default style of the account. A bubble color that
 * is automatic follows the wallpaper.
 */
export function getChatStyleColors(
  style: ChatStyleRecord | undefined,
  defaultStyle: ChatStyleRecord | undefined,
  customColors: Record<string, CustomChatColorRecord> | undefined,
): ChatStyleColors {
  const wallpaperPreset = style?.wallpaperPreset ?? defaultStyle?.wallpaperPreset;
  const customColorId = style?.customColorId ?? (style?.bubbleColorPreset ? undefined : defaultStyle?.customColorId);
  const bubbleColorPreset = style?.bubbleColorPreset
    ?? (style?.customColorId ? undefined : defaultStyle?.bubbleColorPreset)
    ?? (wallpaperPreset ? AUTO_BUBBLE_COLORS[wallpaperPreset] : undefined);

  const custom = customColorId ? customColors?.[customColorId] : undefined;
  return {
    bubble: custom ? getCustomColorCss(custom) : bubbleColorPreset ? BUBBLE_COLORS[bubbleColorPreset] : undefined,
    wallpaper: wallpaperPreset ? WALLPAPER_COLORS[wallpaperPreset] : undefined,
  };
}

function getCustomColorCss({ solid, gradient: customGradient }: CustomChatColorRecord) {
  if (solid !== undefined) return toHex(solid);
  if (!customGradient?.colors.length) return undefined;
  const { colors, positions } = customGradient;
  const stops = colors.map((color, index) => (
    `${toHex(color)} ${Math.round((positions[index] ?? index / colors.length) * PERCENT)}%`
  ));
  return `linear-gradient(${customGradient.angle}deg, ${stops.join(', ')})`;
}

/** `#rrggbb` of a 0xAARRGGBB color */
function toHex(argb: number) {
  return `#${(argb & COLOR_MASK).toString(HEX_RADIX).padStart(COLOR_DIGITS, '0')}`;
}

function gradient(angle: number, start: string, end: string) {
  return `linear-gradient(${angle}deg, ${start}, ${end})`;
}
