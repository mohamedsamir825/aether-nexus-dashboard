/**
 * NEXUS design tokens.
 *
 * The direction is fixed by ADR 0012: a dark operations room, gold and cyan on
 * near-black, with information density borrowed from a dense analytics layout.
 * This file turns that direction into numbers.
 *
 * Authored in OKLCH so the ramps step evenly, then verified against WCAG in
 * tests. Nothing here is chosen because it looked right in isolation -- every
 * pairing that carries text has a measured contrast ratio behind it.
 *
 * These are tokens, not components. Phase 14 builds the interface; this exists
 * so that when it does, the palette is already settled and already legible.
 */
import { type Oklch, oklchToHex } from './color.ts';

/** Hues, fixed once so every ramp stays on the same three. */
export const HUE = {
  /** Gold. The single accent — used for what matters, never for decoration. */
  brass: 85,
  /** Cyan. Secondary: links, live indicators, selected state. */
  signal: 220,
  /** Slightly blue-biased neutral, so greys read as chosen rather than default. */
  slate: 250,
} as const;

/**
 * Perceptual lightness steps. Even spacing in OKLCH means even spacing to the
 * eye, which is the whole reason for authoring here rather than in HSL.
 */
const STEP = [0.12, 0.18, 0.25, 0.34, 0.45, 0.58, 0.70, 0.80, 0.88, 0.95] as const;

function ramp(hue: number, chroma: number): readonly string[] {
  // Chroma tapers at both ends: near-black and near-white cannot hold much
  // colour in sRGB, and forcing it there pushes the ramp out of gamut.
  return STEP.map((l, i) => {
    const taper = 1 - Math.abs(i - STEP.length / 2 + 0.5) / (STEP.length / 2);
    const color: Oklch = { l, c: chroma * (0.35 + 0.65 * taper), h: hue };
    return oklchToHex(color);
  });
}

export const RAMP = {
  slate: ramp(HUE.slate, 0.022),
  brass: ramp(HUE.brass, 0.11),
  signal: ramp(HUE.signal, 0.10),
} as const;

/**
 * Semantic status. Deliberately separate from the accent: an operator must be
 * able to tell "this is important" from "this is broken" without reading.
 * Hues are far apart so the three remain distinguishable for the most common
 * forms of colour blindness, and each is paired with a shape or label in the
 * interface rather than carrying meaning by colour alone.
 */
export const STATUS_HUE = { ok: 150, warn: 75, down: 25 } as const;

/**
 * Lightness is spread deliberately, not just hue.
 *
 * The first attempt gave the three statuses near-identical lightness and only
 * differing hue -- and a test caught that `ok` and `warn` sat at a contrast
 * ratio of 1.03 against each other. Distinguishable to a trichromat, identical
 * to anyone with a red-green deficiency. Separating them by brightness is what
 * makes the set readable without colour vision, and it is why the pairwise
 * check below is a test rather than a guideline.
 */
export const STATUS = {
  ok: {
    dark: oklchToHex({ l: 0.80, c: 0.14, h: STATUS_HUE.ok }),
    light: oklchToHex({ l: 0.52, c: 0.14, h: STATUS_HUE.ok }),
  },
  warn: {
    dark: oklchToHex({ l: 0.88, c: 0.13, h: STATUS_HUE.warn }),
    light: oklchToHex({ l: 0.62, c: 0.14, h: STATUS_HUE.warn }),
  },
  down: {
    dark: oklchToHex({ l: 0.64, c: 0.17, h: STATUS_HUE.down }),
    light: oklchToHex({ l: 0.44, c: 0.19, h: STATUS_HUE.down }),
  },
} as const;

/** Dark is the primary theme (ADR 0012); light is a full peer, not an inversion. */
export const THEME = {
  dark: {
    ground: oklchToHex({ l: 0.14, c: 0.008, h: HUE.slate }),
    panel: oklchToHex({ l: 0.19, c: 0.010, h: HUE.slate }),
    panelSunk: oklchToHex({ l: 0.16, c: 0.009, h: HUE.slate }),
    rule: oklchToHex({ l: 0.30, c: 0.012, h: HUE.slate }),
    ink: oklchToHex({ l: 0.93, c: 0.006, h: HUE.slate }),
    inkSoft: oklchToHex({ l: 0.74, c: 0.010, h: HUE.slate }),
    inkFaint: oklchToHex({ l: 0.58, c: 0.012, h: HUE.slate }),
    accent: oklchToHex({ l: 0.78, c: 0.12, h: HUE.brass }),
    signal: oklchToHex({ l: 0.76, c: 0.10, h: HUE.signal }),
  },
  light: {
    ground: oklchToHex({ l: 0.96, c: 0.004, h: HUE.slate }),
    panel: oklchToHex({ l: 1.0, c: 0, h: HUE.slate }),
    panelSunk: oklchToHex({ l: 0.93, c: 0.006, h: HUE.slate }),
    rule: oklchToHex({ l: 0.84, c: 0.010, h: HUE.slate }),
    ink: oklchToHex({ l: 0.20, c: 0.010, h: HUE.slate }),
    inkSoft: oklchToHex({ l: 0.42, c: 0.012, h: HUE.slate }),
    inkFaint: oklchToHex({ l: 0.56, c: 0.012, h: HUE.slate }),
    accent: oklchToHex({ l: 0.48, c: 0.11, h: HUE.brass }),
    signal: oklchToHex({ l: 0.45, c: 0.11, h: HUE.signal }),
  },
} as const;

export type ThemeName = keyof typeof THEME;

/**
 * Type. Two families: a monospace that carries data, labels and traces, and a
 * sans that carries prose. The interface is mostly instrument, so the mono does
 * most of the work.
 *
 * Arabic is a first-class script here, not an afterthought — the owner reads it
 * — so the sans is chosen for having a real Arabic cut.
 */
export const TYPE = {
  family: {
    mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
    sans: '"IBM Plex Sans Arabic", "IBM Plex Sans", system-ui, sans-serif',
  },
  /** Major-third-ish scale, in rem. */
  scale: {
    micro: 0.694,
    small: 0.833,
    body: 1,
    lead: 1.2,
    h3: 1.44,
    h2: 1.728,
    h1: 2.074,
    display: 2.488,
  },
  weight: { regular: 400, medium: 500, semibold: 600 },
  leading: { tight: 1.25, normal: 1.55, prose: 1.75 },
  /** Uppercase labels need it; running text does not. */
  tracking: { label: '0.12em', normal: '0' },
} as const;

/** 4px base. Dense layouts need small steps to stay ordered. */
export const SPACE = {
  '0': '0', '1': '0.25rem', '2': '0.5rem', '3': '0.75rem', '4': '1rem',
  '5': '1.5rem', '6': '2rem', '7': '3rem', '8': '4rem', '9': '6rem',
} as const;

/**
 * Motion. Short and few: per ADR 0012 anything that does not encode real system
 * state is decoration. These durations exist for state changes, not for flourish.
 */
export const MOTION = {
  duration: { instant: '80ms', fast: '140ms', normal: '220ms', slow: '400ms' },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    enter: 'cubic-bezier(0, 0, 0, 1)',
    exit: 'cubic-bezier(0.3, 0, 1, 1)',
  },
  /** Every animation must be skippable; reduced-motion is not optional. */
  reducedMotionFallback: '1ms',
} as const;

export const RADIUS = { none: '0', sm: '2px', md: '4px', panel: '6px' } as const;
