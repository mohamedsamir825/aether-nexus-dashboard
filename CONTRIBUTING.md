# Contributing

Thanks for helping improve Aether Nexus Dashboard.

## Setup

```bash
bun install
bun run dev
```

The dev server runs at `http://localhost:3000`.

## Checks

Run these before opening a pull request:

```bash
bun run lint
bun run build
```

## Pull Requests

- Keep changes focused and easy to review.
- Include screenshots or short clips for visual changes.
- Update `README.md`, `DESIGN.md`, or `TODO.md` when behavior, setup, or release scope changes.
- Avoid adding runtime services, API keys, or environment variables unless the feature clearly needs them.

## Style

- Prefer existing component patterns before adding abstractions.
- Keep the interface dense, calm, and operational.
- Use Bun commands in docs and automation.
