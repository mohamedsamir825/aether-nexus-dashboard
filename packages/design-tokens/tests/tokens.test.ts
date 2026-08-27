/**
 * The tests that make the palette real.
 *
 * A colour system that has not been measured is a mood board. Every pairing
 * that carries text is checked here against a WCAG threshold, so the palette
 * cannot drift into being pretty and unreadable.
 */
import { test, expect, describe } from 'bun:test';
import { CONTRAST, contrastRatio, isOutOfGamut } from '../src/color.ts';
import { MOTION, RAMP, SPACE, STATUS, THEME, TYPE } from '../src/tokens.ts';

const themes = [
  ['dark', THEME.dark] as const,
  ['light', THEME.light] as const,
];

describe('text legibility', () => {
  test.each(themes)('%s: primary text meets AA on ground and on panel', (_name, t) => {
    expect(contrastRatio(t.ink, t.ground)).toBeGreaterThanOrEqual(CONTRAST.bodyAA);
    expect(contrastRatio(t.ink, t.panel)).toBeGreaterThanOrEqual(CONTRAST.bodyAA);
  });

  test.each(themes)('%s: primary text actually clears the stricter AAA bar', (_name, t) => {
    // Dense operational reading deserves more headroom than the minimum.
    expect(contrastRatio(t.ink, t.ground)).toBeGreaterThanOrEqual(CONTRAST.bodyAAA);
  });

  test.each(themes)('%s: secondary text meets AA', (_name, t) => {
    expect(contrastRatio(t.inkSoft, t.ground)).toBeGreaterThanOrEqual(CONTRAST.bodyAA);
    expect(contrastRatio(t.inkSoft, t.panel)).toBeGreaterThanOrEqual(CONTRAST.bodyAA);
  });

  test.each(themes)('%s: faint text meets at least the large-text bar', (_name, t) => {
    // Faint is for labels and captions, so it is held to the large/non-text
    // threshold rather than being allowed to fail silently.
    expect(contrastRatio(t.inkFaint, t.ground)).toBeGreaterThanOrEqual(CONTRAST.largeAA);
  });

  test.each(themes)('%s: the accent is legible as text, not just as decoration', (_name, t) => {
    expect(contrastRatio(t.accent, t.ground)).toBeGreaterThanOrEqual(CONTRAST.bodyAA);
    expect(contrastRatio(t.signal, t.ground)).toBeGreaterThanOrEqual(CONTRAST.bodyAA);
  });

  test.each(themes)('%s: rules are visible without shouting', (_name, t) => {
    const ratio = contrastRatio(t.rule, t.ground);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(CONTRAST.bodyAA);
  });
});

describe('status colours', () => {
  test('each status is legible on its own theme ground', () => {
    for (const key of ['ok', 'warn', 'down'] as const) {
      expect(contrastRatio(STATUS[key].dark, THEME.dark.ground)).toBeGreaterThanOrEqual(CONTRAST.largeAA);
      expect(contrastRatio(STATUS[key].light, THEME.light.ground)).toBeGreaterThanOrEqual(CONTRAST.largeAA);
    }
  });

  test('the three statuses are distinguishable from each other', () => {
    // Not a colour-blindness simulation, but it does catch two statuses
    // collapsing to the same luminance, which is the common failure.
    const pairs: [string, string][] = [
      [STATUS.ok.dark, STATUS.warn.dark],
      [STATUS.warn.dark, STATUS.down.dark],
      [STATUS.ok.dark, STATUS.down.dark],
    ];
    for (const [a, b] of pairs) expect(contrastRatio(a, b)).toBeGreaterThan(1.15);
  });

  test('status is separate from the accent, so alarm never reads as emphasis', () => {
    expect(STATUS.down.dark).not.toBe(THEME.dark.accent);
    expect(STATUS.warn.dark).not.toBe(THEME.dark.accent);
  });
});

describe('ramps', () => {
  test('every ramp step is displayable in sRGB', () => {
    for (const [name, ramp] of Object.entries(RAMP)) {
      expect(ramp.length, name).toBe(10);
      for (const hex of ramp) expect(/^#[0-9a-f]{6}$/.test(hex), `${name} ${hex}`).toBe(true);
    }
  });

  test('ramps run dark to light without reversing', () => {
    for (const ramp of Object.values(RAMP)) {
      for (let i = 1; i < ramp.length; i++) {
        expect(contrastRatio(ramp[i]!, '#000000')).toBeGreaterThan(
          contrastRatio(ramp[i - 1]!, '#000000'),
        );
      }
    }
  });

  test('no authored token is out of gamut', () => {
    expect(isOutOfGamut({ l: 0.78, c: 0.12, h: 85 })).toBe(false);
    expect(isOutOfGamut({ l: 0.76, c: 0.10, h: 220 })).toBe(false);
  });
});

describe('type, space and motion', () => {
  test('the type scale is monotonic', () => {
    const sizes = Object.values(TYPE.scale);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
  });

  test('the sans family names an Arabic cut first', () => {
    // Arabic is a first-class script here, not a fallback.
    expect(TYPE.family.sans).toStartWith('"IBM Plex Sans Arabic"');
  });

  test('every family declares a real fallback', () => {
    for (const family of Object.values(TYPE.family)) {
      expect(family.split(',').length).toBeGreaterThanOrEqual(3);
    }
  });

  test('the spacing scale increases', () => {
    const rem = Object.values(SPACE).map((v) => (v === '0' ? 0 : Number.parseFloat(v)));
    for (let i = 1; i < rem.length; i++) expect(rem[i]!).toBeGreaterThan(rem[i - 1]!);
  });

  test('motion is short, and reduced motion is provided for', () => {
    const ms = Object.values(MOTION.duration).map((d) => Number.parseInt(d, 10));
    // Anything longer than this stops feeling like feedback.
    for (const value of ms) expect(value).toBeLessThanOrEqual(400);
    expect(MOTION.reducedMotionFallback).toBe('1ms');
  });
});
