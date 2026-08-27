# Design assets — sourced and evaluated

Research done ahead of Phase 14, so the decisions exist before the pressure to
ship an interface does.

**Deliberately not done: downloading the assets themselves.** Map tiles, icon
sets and audio files are megabytes of binaries for a phase nine steps away, and
whatever we pulled now would be stale by then. What survives waiting is the
*decision and its licence*; the bytes are a `curl` away once the interface is
real. The one exception is colour, which is not an asset but a system — that
one is built and verified (`packages/design-tokens`).

---

## 1 · Map and globe data

The Command Center's intelligence map (ADR 0012, reference #1).

| | |
| --- | --- |
| **Data** | [Natural Earth](https://www.naturalearthdata.com/) at 1:110m for the globe, 1:50m for regional detail |
| **Licence** | **Public domain** (Open Data Commons PDDL). No attribution required, though it is polite |
| **Format** | Pre-built TopoJSON from [world-atlas](https://github.com/topojson/world-atlas); GeoJSON from [natural-earth-geojson](https://github.com/martynafford/natural-earth-geojson) |
| **Renderer** | [deck.gl `GlobeView`](https://deck.gl/docs/api-reference/core/globe-view) |

**Why this and not a tile provider.** Tiles mean an API key, a rate limit, a
per-view cost and a third party who can see what the owner is looking at. A
public-domain vector file has none of those, ships with the app, and works
offline. For a private personal system that is not a trade-off — it is simply
better.

**Scale matters more than it sounds.** 1:110m is roughly 200KB as TopoJSON and
is correct for a whole-globe view; 1:10m is tens of megabytes and would be
invisible at that zoom. Start coarse.

**Caution.** `GlobeView` is still marked experimental in deck.gl. Treat the
globe as the dedicated view ADR 0012 already assigns it, so if it has to be
dropped the main dashboard is unaffected.

---

## 2 · Colour — built, not just chosen

**Status: done.** `packages/design-tokens`, 32 tests.

Authored in **OKLCH** because it is perceptually uniform: lightness `0.6` reads
as the same brightness at every hue, which HSL does not give you. In HSL a gold
and a cyan at the same lightness differ visibly, so a palette built on it needs
endless hand-correction.

**Perceptual uniformity is not accessibility.** OKLCH makes a palette
consistent; only a contrast ratio makes it legible. So every pairing that
carries text is checked against WCAG in a test, and `oklchToHex` clamps chroma
into sRGB rather than letting the browser clip — clipping shifts hue and
lightness silently and destroys the even spacing that was the reason for using
OKLCH at all.

**What the tests caught.** The first status palette separated `ok`, `warn` and
`down` by hue while leaving their lightness nearly equal. `ok` and `warn` sat at
a contrast ratio of **1.03** against each other: distinguishable to a
trichromat, identical to anyone with a red-green deficiency. They are now
separated by brightness as well as hue, and the pairwise check is a test so it
cannot regress.

Run `bun run --filter '@nexus/design-tokens' css` to emit CSS custom properties.
The TypeScript is the source of truth; the CSS is a rendering of it, so the
palette the interface uses is the one the tests verify.

Sources: [OKLCH in CSS](https://csstools.io/blog/css-oklch-color-guide) ·
[perceptual colour spaces](https://auricartisan.com/library/learn/articles/2026-06-02-oklab-oklch-perceptual-color-spaces) ·
[accessible OKLCH patterns](http://www.trustedguides24.com/design/designing-accessible-color-systems-with-oklch-practical-patterns-for-ui-teams.html)

---

## 3 · Sound — earcons, for Phase 13

Voice (Phase 13) needs non-speech audio, and the research is unambiguous about
why: **silence is the dangerous state**. Roughly three seconds of it after a
user speaks reads as failure, so the system must sound like it is doing
something even when it has nothing to say yet.

Four states need a sound, and only four:

| State | Character | Why |
| --- | --- | --- |
| Listening | A short rising ping | Confirms the wake word landed |
| Thinking | A quiet, looping pulse | Fills the silence that would otherwise read as failure |
| Done | A settled two-note fall | Closes the interaction |
| Failed | A flat, non-musical tone | Must not be mistakable for success |

**Recommendation: synthesise, do not download.** Four earcons are a few dozen
lines of Web Audio — oscillator, gain envelope, done. That keeps them in the
token system where their pitch and length are tunable, adds no binary assets, no
licence to track, and no 404 in three years. Sample libraries are the right
answer when you need a *texture*; these are signals.

**Constraints:** every earcon under 400ms except the thinking loop; all audio
respects a mute preference; and audio must never be the only channel — the
interface shows state visually in parallel, which is also what makes the system
usable with the sound off.

Sources: [earcons](https://medium.com/vui-magazine/earcons-the-audio-version-of-an-icon-59b7f0921235) ·
[VUI practice 2026](https://udesignate.com/designing-voice-interfaces-2026-practical-vui-guide/)

---

## 4 · Motion

Tokens shipped (`MOTION` in `packages/design-tokens`). Four durations,
80–400ms, three easings.

ADR 0012's rule governs: **motion that does not encode real system state is
decoration and gets removed.** So the durations exist for state transitions — a
division lighting up because an agent actually started, a status pill changing
because health actually changed — not for entrances. `prefers-reduced-motion`
collapses every duration to `1ms`, and the CSS emitter writes that block
automatically rather than leaving it to be remembered.

---

## 5 · Typography

`IBM Plex Mono` for data, labels and traces; `IBM Plex Sans Arabic` for prose.

Plex was drawn for technical contexts, has a genuine Arabic cut rather than a
bolted-on fallback, and is open licence (SIL OFL). Arabic is a first-class
script here because the owner reads it — a test asserts the Arabic family is
named first, so it cannot quietly become a fallback.

Both are on Google Fonts, which is the one font host an Artifact's CSP admits.
Self-host for the real interface.

---

## What is decided, and what is not

**Decided:** map data and its licence · the whole colour system · earcon
approach · motion budget · typefaces.

**Open, on purpose:** the globe's visual treatment (needs real division state to
design against) · icon set (no inventory of what needs an icon yet) · chart
library (the `dataviz` guidance applies when there is data worth charting) ·
whether `apps/dashboard` is adopted or deleted (ADR 0003, decides at Phase 14).
