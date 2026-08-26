> **Vendored template — not part of NEXUS Core.**
>
> This is a third-party, frontend-only dashboard template retained as a possible
> starting point for a future NEXUS UI. It is **not wired to NEXUS Core**: all of
> its data is hardcoded fixtures, and nothing in `packages/core` depends on it.
> See [ADR 0003](../../docs/adr/0003-quarantine-dashboard-template.md).
>
> Original work by [bymilon](https://github.com/bymilon), MIT licensed, retained
> unmodified apart from being moved into this workspace.

# Aether Nexus Dashboard

A dense React dashboard template for AI-assisted operations, telemetry, and review workflows.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646cff.svg)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8.svg)](https://tailwindcss.com/)

Aether Nexus Dashboard is a static, frontend-only command-center starter. It combines a responsive app shell, operational charts, task review queues, activity streams, and an AI companion panel into one compact interface that can be adapted for internal tools, analytics products, and AI workflow prototypes.

## Features

- Responsive three-pane dashboard shell with mobile drawers.
- KPI cards, sparklines, area charts, task queues, and activity feeds.
- AURA side panel for AI-assisted diagnostic and review workflows.
- Tailwind CSS 4 theme tokens for a dark operational interface.
- Recharts visualizations and Lucide React icons.
- No backend, API keys, or runtime environment variables required.

## Stack

- React 19
- TypeScript
- Vite 6
- Tailwind CSS 4
- Recharts
- Lucide React
- Bun

## Quick Start

```bash
bun install                 # from the repository root
bun run dashboard:dev       # or: bun run --filter '@nexus/dashboard' dev
```

The dev server runs at `http://localhost:3000`.

## Scripts

```bash
bun run dev      # Start Vite on port 3000
bun run build    # Create a production build in dist/
bun run preview  # Preview the production build
bun run lint     # Type-check with TypeScript
```

## Project Structure

```txt
src/
  components/       Sidebar, main dashboard content, and AURA panel
  App.tsx           Layout state and responsive panel composition
  index.css         Tailwind theme tokens and global styles
  main.tsx          React entry point
DESIGN.md          Visual design notes and customization guidance
TODO.md            Linear-style OSS release backlog
```

## Customization

- Edit navigation and workspace copy in `src/components/Sidebar.tsx`.
- Adjust KPI cards, chart data, task queues, and activity feeds in `src/components/MainContent.tsx`.
- Update AURA panel prompts, generated diagnostic content, and composer actions in `src/components/AIPanel.tsx`.
- Tune colors, typography, and scrollbar styling in `src/index.css`.
- Use `DESIGN.md` for layout, palette, and interaction guidance.

## Roadmap

See [TODO.md](TODO.md) for the release backlog. Tasks are written in a Linear-style format so they can be moved into GitHub issues later.

## Contributing

Issues and pull requests are welcome. Keep changes focused, include screenshots for visual changes, and run:

```bash
bun run lint
bun run build
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

Do not open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
