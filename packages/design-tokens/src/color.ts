/**
 * Colour maths: OKLCH authoring, sRGB output, WCAG verification.
 *
 * Tokens are authored in OKLCH because it is perceptually uniform -- a
 * lightness of 0.5 reads as a mid-tone whatever the hue, which HSL does not
 * give you. That property is what makes a ramp legible: in HSL, gold at 50%
 * lightness is visibly brighter than cyan at 50%, so a palette built on it
 * needs constant hand-correction.
 *
 * But perceptual uniformity is not accessibility. OKLCH makes a palette
 * *consistent*; only a contrast ratio makes it *legible*. So every token is
 * authored in OKLCH and then checked numerically here, and the checks are
 * tests rather than a designer's judgement.
 *
 * Conversion follows Björn Ottosson's Oklab derivation.
 */

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  readonly l: number;
  /** Chroma, 0..~0.4 in sRGB. */
  readonly c: number;
  /** Hue angle in degrees. */
  readonly h: number;
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const cube = (x: number): number => x * x * x;

/** Linear-light sRGB from OKLCH. Values may fall outside 0..1 (out of gamut). */
export function oklchToLinearSrgb(color: Oklch): Rgb {
  const radians = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(radians);
  const b = color.c * Math.sin(radians);

  const l = cube(color.l + 0.3963377774 * a + 0.2158037573 * b);
  const m = cube(color.l - 0.1055613458 * a - 0.0638541728 * b);
  const s = cube(color.l - 0.0894841775 * a - 1.291485548 * b);

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** sRGB transfer function. */
export function encodeGamma(channel: number): number {
  const x = clamp01(channel);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Inverse sRGB transfer function. */
export function decodeGamma(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** True when the colour cannot be shown in sRGB without clipping. */
export function isOutOfGamut(color: Oklch): boolean {
  const { r, g, b } = oklchToLinearSrgb(color);
  const tolerance = 1e-4;
  return [r, g, b].some((channel) => channel < -tolerance || channel > 1 + tolerance);
}

/**
 * The most chroma this lightness and hue can hold in sRGB.
 *
 * Authoring in OKLCH lets you ask for colours sRGB cannot show, and the usual
 * result is silent clipping that shifts both hue and lightness. Clamping first
 * keeps the ramp's perceptual spacing intact, which was the reason for choosing
 * OKLCH in the first place.
 */
export function clampChromaToGamut(color: Oklch): Oklch {
  if (!isOutOfGamut(color)) return color;
  let low = 0;
  let high = color.c;
  // 20 halvings resolves chroma far finer than an 8-bit channel can show.
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (isOutOfGamut({ ...color, c: mid })) high = mid;
    else low = mid;
  }
  return { ...color, c: low };
}

export function oklchToHex(color: Oklch): string {
  // Always clamped: a token should never be defined by what clipping happened
  // to produce.
  const linear = oklchToLinearSrgb(clampChromaToGamut(color));
  const toByte = (channel: number): string =>
    Math.round(encodeGamma(channel) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(linear.r)}${toByte(linear.g)}${toByte(linear.b)}`;
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * decodeGamma(rgb.r) + 0.7152 * decodeGamma(rgb.g) + 0.0722 * decodeGamma(rgb.b)
  );
}

/** WCAG contrast ratio, 1..21. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(hexToRgb(a));
  const second = relativeLuminance(hexToRgb(b));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return Number((((lighter + 0.05) / (darker + 0.05))).toFixed(3));
}

/** WCAG thresholds. `large` is 18.66px bold or 24px regular and above. */
export const CONTRAST = {
  bodyAA: 4.5,
  largeAA: 3,
  /** Non-text: UI component boundaries, focus rings, chart marks. */
  nonTextAA: 3,
  bodyAAA: 7,
} as const;

export function meetsContrast(foreground: string, background: string, minimum: number): boolean {
  return contrastRatio(foreground, background) >= minimum;
}
