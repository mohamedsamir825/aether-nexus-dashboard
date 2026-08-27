import { test, expect, describe } from 'bun:test';
import {
  contrastRatio, decodeGamma, encodeGamma, hexToRgb,
  isOutOfGamut, meetsContrast, oklchToHex, relativeLuminance,
} from '../src/color.ts';

describe('OKLCH conversion', () => {
  test('the achromatic ends land exactly', () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe('#ffffff');
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe('#000000');
  });

  test('hue does not change lightness — the reason for using OKLCH', () => {
    // In HSL these would differ visibly. Here they must not.
    const luminances = [0, 90, 180, 270].map((h) =>
      relativeLuminance(hexToRgb(oklchToHex({ l: 0.6, c: 0.08, h }))),
    );
    const spread = Math.max(...luminances) - Math.min(...luminances);
    expect(spread).toBeLessThan(0.06);
  });

  test('lightness is monotonic along a ramp', () => {
    const steps = [0.2, 0.4, 0.6, 0.8].map((l) =>
      relativeLuminance(hexToRgb(oklchToHex({ l, c: 0.05, h: 85 }))),
    );
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
    }
  });

  test('detects colours sRGB cannot show', () => {
    expect(isOutOfGamut({ l: 0.9, c: 0.35, h: 140 })).toBe(true);
    expect(isOutOfGamut({ l: 0.6, c: 0.05, h: 140 })).toBe(false);
  });

  test('the gamma transfer functions are inverses', () => {
    for (const v of [0, 0.02, 0.25, 0.5, 0.9, 1]) {
      expect(decodeGamma(encodeGamma(v))).toBeCloseTo(v, 6);
    }
  });
});

describe('WCAG contrast', () => {
  test('the known extremes are right', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#000000', '#000000')).toBe(1);
  });

  test('argument order does not matter', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBe(contrastRatio('#abcdef', '#123456'));
  });

  test('matches a published reference value', () => {
    // #767676 on white is the canonical "just passes AA" grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1);
  });

  test('meetsContrast applies the threshold', () => {
    expect(meetsContrast('#ffffff', '#000000', 4.5)).toBe(true);
    expect(meetsContrast('#777777', '#808080', 4.5)).toBe(false);
  });
});
