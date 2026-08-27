# NEXUS Design

Design direction is **captured, not implemented**. The Command Center is Phase 14
(`../NEXUS_MASTER_SPEC.md` §25); this folder exists so the decision and its
references survive until then.

The binding decision is [ADR 0012](../adr/0012-command-center-design-direction.md).

## Reference hierarchy

The first reference governs. Later references contribute specific things and
nothing more.

| # | Reference | What we take | What we do NOT take |
| --- | --- | --- | --- |
| 1 | **NEXUS Command Center mock-up** | Layout, palette (gold/cyan on black), division sidebar, intelligence map, threat levels, system status. **The governing reference.** | — |
| 2 | **Z.E.R.O. / THINKIFO** (`references/zero-*.jpg`) | Voice + wake word, module status column, transcript line, large right-aligned numbers, corner brackets, spaced monospace type | Its name, branding, or identity |
| 3 | **Maxton** (Envato Elements, by codervent) | **Information density only** — how 8–10 widgets fit one screen without crowding | Its colours, look, illustrations, or code |

## Assets and tokens

[`ASSETS.md`](ASSETS.md) records the researched decisions — map data and its
licence, the colour system, earcons, motion, typography — with what is settled
and what is deliberately still open.

The colour system is not a mood board: `packages/design-tokens` builds it in
OKLCH and verifies every text pairing against WCAG in tests.

## Files

`references/` holds frames extracted from a reference video the project owner
supplied:

| File | Shows |
| --- | --- |
| `zero-screen-detail.jpg` | The clearest read of the full screen — four KPI panels, module status column, transcript line |
| `zero-screen-early.jpg` | Earlier state with different panels visible |
| `zero-room-context.jpg` | The wall-mounted context: ambient-lit room, always-on display |
| `zero-voice-moment.jpg` | The voice interaction — `MIC — LISTENING FOR "HEY ZERO"` and the live transcript |

**Missing:** the NEXUS Command Center mock-up and the Maxton screenshot were
pasted into chat rather than uploaded as files, so they are not stored here. The
mock-up is reference #1 and matters most — it should be added to this folder as
a file.

## Provenance and use

These frames are **third-party material**, retained as internal design reference
under fair use. They are not our work, must not be redistributed, and no visual
identity, name or branding from them is to be copied. What we take from a
reference is an *idea about how information is organised*, never its identity.
The same rule already applied to the vendored dashboard template ([ADR 0003](../adr/0003-quarantine-dashboard-template.md)).
