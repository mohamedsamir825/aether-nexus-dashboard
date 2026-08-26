# Design Notes

Aether Nexus Dashboard is designed as a dense operational surface, not a marketing page. Keep the first screen focused on live state, review work, and context switching.

## Layout

- Preserve the three-zone shell: left navigation, main telemetry canvas, and right AURA panel.
- Keep panels compact and scannable. Use cards for individual widgets, not for whole page sections.
- Maintain responsive drawer behavior for the sidebar and AURA panel on smaller viewports.
- Avoid layout shifts when chart data, labels, or task names change.

## Visual Style

- Use the matte dark palette in `src/index.css` as the base.
- Reserve bright accents for state, selection, alerts, and chart emphasis.
- Keep text hierarchy tight: small section labels, medium widget headings, and a single prominent dashboard heading.
- Use Lucide React icons for controls and navigation.

## Interaction

- Icon-only controls should include accessible labels before release.
- Dashboard controls should feel immediate and tool-like.
- Visual changes should be verified on desktop and mobile screenshots.

## Content

- Use operational language: nodes, cycles, diagnostics, streams, and review queues.
- Keep AI copy concrete and inspectable; avoid claims that imply a real backend exists.
- Treat sample data as replaceable fixtures until the app is wired to a real data source.
