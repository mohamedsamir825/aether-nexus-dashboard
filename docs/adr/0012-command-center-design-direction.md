# ADR 0012 — Command Center design direction

**Status:** Accepted · **Date:** 2026-08-26

## Context

Three visual references were supplied, and they do not agree with each other. A
decision recorded now costs nothing; the same decision made during Phase 14, with
implementation pressure behind it, tends to be made by whoever is holding the
mouse.

The references:

1. A **NEXUS Command Center mock-up** — dark operations room, world intelligence
   map, threat levels, division sidebar, agent status, disciplined gold-and-cyan
   palette on black.
2. **Z.E.R.O. / THINKIFO** — a wall-mounted, always-on, voice-driven system. A
   central neural visualisation of named modules with live firing indicators,
   four KPI panels, a module status column reading `LIVE` / `ON` / `PLANNED`, a
   live transcript line, and `MIC — LISTENING FOR "HEY ZERO"`.
3. **Maxton** (Envato Elements, by codervent) — a commercial Bootstrap admin
   template: bright multi-colour analytics dashboard, very high widget density.

These pull in different directions. Maxton is a cheerful analytics product;
1 and 2 are operations rooms. Left unresolved, the interface would drift toward
whichever reference was open at the time.

## Decision

**A strict reference hierarchy. The first governs; the others contribute one
named thing each and nothing more.**

| # | Reference | Contributes | Explicitly excluded |
| --- | --- | --- | --- |
| 1 | NEXUS Command Center mock-up | **Governing reference.** Layout, palette, division sidebar, intelligence map, threat levels, system status | — |
| 2 | Z.E.R.O. | Voice and wake word; module status column with `LIVE`/`ON`/`PLANNED`; transcript line; large right-aligned numerals; corner brackets; spaced monospace type | Its name, branding, identity |
| 3 | Maxton | **Information density only** — how 8–10 widgets occupy one screen without crowding | Its colours, look, illustrations, code |

**Two further decisions, both about the central visualisation:**

**The agent visualisation gets its own view.** Z.E.R.O. gives its neural graphic
roughly 60% of the screen while it conveys comparatively little. In NEXUS it
occupies a dedicated page; the main dashboard shows at most a compact indicator.
Screen area is allocated by information conveyed, not by visual appeal.

**Each region is a real division** — Finance, Research, Business, Learning,
Performance, Engineering, Legal — lit when an agent inside it is actually
running, with connecting lines representing real delegation through the
Supervisor. Anatomical labels (`PREFRONTAL`, `HIPPOCAMPUS`, …) may sit as a
secondary layer for character, but the primary label is the division, because
that is the thing that is true.

This is §17.2 applied rather than restated: **motion or glow that does not encode
real system state is decoration and gets removed.** The visualisation earns its
space only if every element reports something.

## Consequences

Good: one governing reference ends the drift. The specification's existing §17
direction is confirmed rather than replaced, so nothing already written is
wasted. Tying regions to divisions makes the most decorative-looking element the
most informative one, and it can only be built once real division state exists —
which naturally prevents building it too early.

Bad: constraining the visualisation to real state means it will look sparse until
several divisions exist. That is the honest appearance of an early system, and
resisting the urge to fill it with plausible-looking activity will take
discipline — a fabricated dashboard is precisely what this project has avoided
from the first commit.

## Licence and provenance

Maxton is an Envato Elements template with licence terms. We use **no Maxton
code** — it is Bootstrap, NEXUS is React and Tailwind — and take only the
principle of information density, which no licence governs. Z.E.R.O. is another
company's commercial product; we take general functional ideas, never its visual
identity or name. Reference frames retained in `docs/design/references/` are
third-party material held for internal reference and must not be redistributed.
The same posture applies as to the vendored template in [ADR 0003](0003-quarantine-dashboard-template.md).

## Revisit when

Phase 14 begins. Until then this is a captured decision with no code behind it.
