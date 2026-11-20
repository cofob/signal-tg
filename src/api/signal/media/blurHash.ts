// BlurHash, as Signal clients put it into `AttachmentPointer.blurHash`:
// https://github.com/woltapp/blurhash/blob/master/Algorithm.md

import { bufferToBase64 } from '../../../util/encoding/buffer';

const BASE83_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const BASE83 = BASE83_DIGITS.length;
const MAX_COMPONENTS = 9;
// Signal Desktop `ts/util/imageToBlurHash.dom.ts` encodes 4 horizontal and 3 vertical components
const COMPONENTS_X = 4;
const COMPONENTS_Y = 3;
const HEADER_LENGTH = 4;
const AC_LEVELS = 19;
const AC_HALF_LEVEL = 9;
const AC_ROUNDING = 9.5;
const MAX_VALUE_STEPS = 166;
const MAX_QUANTISED_MAX_VALUE = 82;
const CHANNEL_MAX = 255;
const SRGB_LINEAR_LIMIT = 0.04045;
const LINEAR_SRGB_LIMIT = 0.0031308;
const SRGB_LINEAR_SLOPE = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_GAMMA = 2.4;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const CHANNEL_MASK = 0xFF;
const DC_LENGTH = 4;
const AC_LENGTH = 2;
const RGBA_LENGTH = 4;

// Thumbnails in app state stay tiny, since the app blurs and stretches them. Signal Desktop
// `ts/util/computeBlurHashUrl.std.ts` draws the same 24-bit top-down BMP at 32 × 32 pixels.
const THUMBNAIL_PIXEL_COUNT = 16 * 16;
const MIN_BITMAP_SIDE = 4;
// Panoramas get a bitmap of this aspect ratio, so neither side grows past the pixel count
const MAX_ASPECT_RATIO = 16;
// BMP rows are padded to 4 bytes; 24-bit rows of a width divisible by 4 need no padding
const BMP_WIDTH_STEP = 4;
const BMP_HEADER = new Uint8Array([
  // File header: "BM", file size, reserved, pixels offset
  0x42, 0x4D, 0, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0,
  // Info header: size, width, height, planes, bits per pixel, no compression, image size,
  // resolution, palette colors, important colors
  0x28, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0, 0x18, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0x01, 0, 0, 0, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const BMP_FILE_SIZE_OFFSET = 0x02;
const BMP_WIDTH_OFFSET = 0x12;
const BMP_HEIGHT_OFFSET = 0x16;
const BMP_IMAGE_SIZE_OFFSET = 0x22;
const BGR_LENGTH = 3;

/** A small BMP data URI of a BlurHash for `ApiThumbnail`; `undefined` for an invalid hash */
export function getBlurHashDataUri(blurHash: string, width?: number, height?: number) {
  const bitmap = renderBlurHash(blurHash, width, height, THUMBNAIL_PIXEL_COUNT);
  return bitmap && `data:image/bmp;base64,${bufferToBase64(bitmap)}`;
}

/**
 * Renders a BlurHash as a BMP of about `pixelCount` pixels with the aspect ratio of `width` × `height`.
 * Returns `undefined` for an invalid hash.
 */
export function renderBlurHash(blurHash: string, width = 1, height = 1, pixelCount: number) {
  const aspectRatio = Math.min(MAX_ASPECT_RATIO, Math.max(1 / MAX_ASPECT_RATIO, width / height));
  const bitmapWidth = Math.max(
    MIN_BITMAP_SIDE,
    Math.floor(Math.sqrt(pixelCount * aspectRatio) / BMP_WIDTH_STEP) * BMP_WIDTH_STEP,
  );
  const bitmapHeight = Math.max(MIN_BITMAP_SIDE, Math.round(bitmapWidth / aspectRatio));

  let colors: number[][];
  try {
    colors = decodeColors(blurHash);
  } catch {
    return undefined;
  }

  const imageSize = bitmapWidth * bitmapHeight * BGR_LENGTH;
  const bitmap = new Uint8Array(BMP_HEADER.length + imageSize);
  bitmap.set(BMP_HEADER);
  const view = new DataView(bitmap.buffer);
  view.setUint32(BMP_FILE_SIZE_OFFSET, bitmap.length, true);
  view.setInt32(BMP_WIDTH_OFFSET, bitmapWidth, true);
  // A negative height stores rows top-down
  view.setInt32(BMP_HEIGHT_OFFSET, -bitmapHeight, true);
  view.setUint32(BMP_IMAGE_SIZE_OFFSET, imageSize, true);

  const componentsX = getComponentsX(blurHash);
  let offset = BMP_HEADER.length;
  for (let y = 0; y < bitmapHeight; y++) {
    for (let x = 0; x < bitmapWidth; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      colors.forEach(([red, green, blue], index) => {
        const basis = Math.cos((Math.PI * x * (index % componentsX)) / bitmapWidth)
          * Math.cos((Math.PI * y * Math.floor(index / componentsX)) / bitmapHeight);
        r += red * basis;
        g += green * basis;
        b += blue * basis;
      });
      bitmap[offset++] = linearToSrgb(b);
      bitmap[offset++] = linearToSrgb(g);
      bitmap[offset++] = linearToSrgb(r);
    }
  }

  return bitmap;
}

/** Encodes RGBA pixels, such as `ImageData.data`, with 4 × 3 components */
export function encodeBlurHash(rgba: Uint8ClampedArray, width: number, height: number) {
  const pixelCount = width * height;
  const linear = new Float32Array(pixelCount * BGR_LENGTH);
  for (let i = 0; i < pixelCount; i++) {
    linear[i * BGR_LENGTH] = srgbToLinear(rgba[i * RGBA_LENGTH]);
    linear[i * BGR_LENGTH + 1] = srgbToLinear(rgba[i * RGBA_LENGTH + 1]);
    linear[i * BGR_LENGTH + 2] = srgbToLinear(rgba[i * RGBA_LENGTH + 2]);
  }

  const factors: number[][] = [];
  for (let j = 0; j < COMPONENTS_Y; j++) {
    for (let i = 0; i < COMPONENTS_X; i++) {
      const factor = [0, 0, 0];
      for (let y = 0; y < height; y++) {
        const basisY = Math.cos((Math.PI * j * y) / height);
        for (let x = 0; x < width; x++) {
          const basis = basisY * Math.cos((Math.PI * i * x) / width);
          const pixel = (y * width + x) * BGR_LENGTH;
          factor[0] += basis * linear[pixel];
          factor[1] += basis * linear[pixel + 1];
          factor[2] += basis * linear[pixel + 2];
        }
      }
      // The DC component is the average color; AC components count twice
      const scale = (i || j ? 2 : 1) / pixelCount;
      factors.push(factor.map((value) => value * scale));
    }
  }

  const [dc, ...ac] = factors;
  const actualMaxValue = Math.max(...ac.flat().map(Math.abs));
  const quantisedMaxValue = Math.max(
    0, Math.min(MAX_QUANTISED_MAX_VALUE, Math.floor(actualMaxValue * MAX_VALUE_STEPS - 0.5)),
  );
  const maxValue = (quantisedMaxValue + 1) / MAX_VALUE_STEPS;
  const quantiseAc = (value: number) => Math.max(
    0, Math.min(AC_LEVELS - 1, Math.floor(signPow(value / maxValue, 0.5) * AC_HALF_LEVEL + AC_ROUNDING)),
  );

  return [
    encodeBase83(COMPONENTS_X - 1 + (COMPONENTS_Y - 1) * MAX_COMPONENTS, 1),
    encodeBase83(quantisedMaxValue, 1),
    encodeBase83(
      (linearToSrgb(dc[0]) << RED_SHIFT) + (linearToSrgb(dc[1]) << GREEN_SHIFT) + linearToSrgb(dc[2]), DC_LENGTH,
    ),
    ...ac.map(([r, g, b]) => encodeBase83(
      quantiseAc(r) * AC_LEVELS * AC_LEVELS + quantiseAc(g) * AC_LEVELS + quantiseAc(b), AC_LENGTH,
    )),
  ].join('');
}

/** Linear RGB colors of the components, row by row; throws for an invalid hash */
function decodeColors(blurHash: string) {
  const componentsX = getComponentsX(blurHash);
  const componentsY = Math.floor(decodeBase83(blurHash, 0, 1) / MAX_COMPONENTS) + 1;
  const componentCount = componentsX * componentsY;
  if (blurHash.length !== HEADER_LENGTH + AC_LENGTH * componentCount) throw new Error('Invalid BlurHash length');

  const maxValue = (decodeBase83(blurHash, 1, 2) + 1) / MAX_VALUE_STEPS;
  const dc = decodeBase83(blurHash, 2, 2 + DC_LENGTH);
  const colors = [[
    srgbToLinear(dc >> RED_SHIFT),
    srgbToLinear((dc >> GREEN_SHIFT) & CHANNEL_MASK),
    srgbToLinear(dc & CHANNEL_MASK),
  ]];
  const decodeAc = (quantised: number) => signPow((quantised - AC_HALF_LEVEL) / AC_HALF_LEVEL, 2) * maxValue;
  for (let i = 1; i < componentCount; i++) {
    const value = decodeBase83(blurHash, HEADER_LENGTH + i * AC_LENGTH, HEADER_LENGTH + (i + 1) * AC_LENGTH);
    colors.push([
      decodeAc(Math.floor(value / (AC_LEVELS * AC_LEVELS))),
      decodeAc(Math.floor(value / AC_LEVELS) % AC_LEVELS),
      decodeAc(value % AC_LEVELS),
    ]);
  }
  return colors;
}

function getComponentsX(blurHash: string) {
  return (decodeBase83(blurHash, 0, 1) % MAX_COMPONENTS) + 1;
}

function decodeBase83(text: string, start: number, end: number) {
  let value = 0;
  for (let i = start; i < end; i++) {
    const digit = BASE83_DIGITS.indexOf(text[i]);
    if (digit === -1) throw new Error('Invalid BlurHash digit');
    value = value * BASE83 + digit;
  }
  return value;
}

function encodeBase83(value: number, length: number) {
  let result = '';
  for (let i = length - 1; i >= 0; i--) {
    result += BASE83_DIGITS[Math.floor(value / BASE83 ** i) % BASE83];
  }
  return result;
}

function srgbToLinear(channel: number) {
  const value = channel / CHANNEL_MAX;
  return value <= SRGB_LINEAR_LIMIT
    ? value / SRGB_LINEAR_SLOPE
    : ((value + SRGB_OFFSET) / (1 + SRGB_OFFSET)) ** SRGB_GAMMA;
}

function linearToSrgb(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  const srgb = clamped <= LINEAR_SRGB_LIMIT
    ? clamped * SRGB_LINEAR_SLOPE
    : (1 + SRGB_OFFSET) * clamped ** (1 / SRGB_GAMMA) - SRGB_OFFSET;
  return Math.round(srgb * CHANNEL_MAX);
}

function signPow(value: number, exponent: number) {
  return Math.sign(value) * Math.abs(value) ** exponent;
}
