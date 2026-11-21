/** A text story background as Signal sends it: an ARGB color, or a linear gradient of ARGB colors */
export type StoryBackground =
  | { color: number }
  | { angle: number; colors: number[]; positions: number[] };

// Signal Desktop `BackgroundStyle` in `ts/components/TextStoryCreator.dom.tsx`
export const STORY_BACKGROUNDS: StoryBackground[] = [
  { color: 4285041620 },
  { color: 4287006657 },
  { color: 4290019212 },
  { color: 4287205768 },
  { color: 4283667331 },
  { angle: 180, colors: [0xff19a9fa, 0xff7097d7, 0xffd1998d, 0xffffc369], positions: [0, 0.33, 0.66, 1] },
  { angle: 180, colors: [0xff4437d8, 0xff6b70de, 0xffb774e0, 0xffff8e8e], positions: [0, 0.33, 0.66, 1] },
  { angle: 180, colors: [0xff004044, 0xff2c5f45, 0xff648e52, 0xff93b864], positions: [0, 0.33, 0.66, 1] },
];

// Signal Desktop `COLOR_WHITE_INT` in `ts/util/getStoryBackground.std.ts`: the default text and background color
export const STORY_COLOR_WHITE = 4294704123;
const PERCENT = 100;
const ARGB_HEX_LENGTH = 8;
const ALPHA_HEX_LENGTH = 2;

/** The CSS color of an ARGB color; Signal clients ignore the alpha channel (Desktop `getHexFromNumber`) */
export function getStoryColorCss(color: number) {
  return `#${(color >>> 0).toString(16).padStart(ARGB_HEX_LENGTH, '0').slice(ALPHA_HEX_LENGTH)}`;
}

/** The CSS background of a text story (Signal Desktop `getBackgroundColor` in `ts/util/getStoryBackground.std.ts`) */
export function getStoryBackgroundCss(background: StoryBackground) {
  if ('color' in background) return getStoryColorCss(background.color || STORY_COLOR_WHITE);
  const { angle, colors, positions } = background;
  const stops = colors.map((color, index) => (
    `${getStoryColorCss(color || STORY_COLOR_WHITE)} ${(positions[index] ?? 1) * PERCENT}%`
  ));
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}
