import { buildColor, mapColorToGamut, serializeColor } from '../lib/color';

export function validateHexColor(color: unknown): color is string {
  return typeof color === 'string' && /^#[0-9A-F]{6}$/i.test(color);
}

export function prepareHexColor(color: string, shouldKeepAlpha?: boolean) {
  try {
    // Without `alpha` a translucent colour keeps its alpha as #rrggbbaa
    return serializeColor(mapColorToGamut(buildColor(color), { space: 'srgb', method: 'clip' }), {
      format: 'hex', collapse: false, alpha: shouldKeepAlpha ? undefined : false,
    });
  } catch {
    return undefined;
  }
}
