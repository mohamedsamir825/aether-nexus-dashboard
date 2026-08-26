# TODO

Linear-style backlog for preparing Aether Nexus Dashboard for open-source release.

Status values: `Backlog`, `Todo`, `In Progress`, `Done`.
Priority values: `P0` release blocker, `P1` release quality, `P2` post-release polish.

## Release Foundation

| ID | Status | Priority | Owner | Task |
| --- | --- | --- | --- | --- |
| AETH-001 | Done | P0 | Release | Create a Linear-style OSS release backlog in `TODO.md`. |
| AETH-002 | Done | P0 | Release | Remove generated AI Studio and Gemini residue from config, metadata, package files, and docs. |
| AETH-003 | Done | P0 | Platform | Normalize `package.json` for the public GitHub repo. |
| AETH-004 | Done | P0 | Platform | Standardize the repo on Bun and replace `package-lock.json` with `bun.lock`. |
| AETH-005 | Done | P1 | Platform | Prune unused dependencies and move build tooling into `devDependencies`. |
| AETH-006 | Done | P0 | GitHub | Initialize the Git repo, set `main` as the default branch, and attach `git@github.com:bymilon/aether-nexus-dashboard.git` as `origin`. |

### Acceptance Criteria

- `vite.config.ts`, `index.html`, `.env.example`, `metadata.json`, and package metadata contain no unused generated-platform references.
- `package.json` uses `aether-nexus-dashboard`, version `0.1.0`, MIT license, correct repository, bugs, homepage, author, keywords, and `packageManager`.
- Only one lockfile is tracked, and Bun is the documented package manager.
- Unused `@google/genai`, `dotenv`, `express`, `motion`, `tsx`, and `@types/express` dependencies are removed unless new runtime usage is added.
- `git remote -v` points to `git@github.com:bymilon/aether-nexus-dashboard.git`.

## Documentation

| ID | Status | Priority | Owner | Task |
| --- | --- | --- | --- | --- |
| AETH-007 | Done | P0 | Docs | Rewrite `README.md` around the actual Aether Nexus Dashboard identity and current UI. |
| AETH-008 | Done | P1 | Docs | Add or remove the stale `DESIGN.md` reference. |
| AETH-009 | Done | P1 | Docs | Document customization points for navigation, KPI cards, chart data, AURA panel content, and theme tokens. |
| AETH-010 | Todo | P2 | Docs | Add screenshots or a short demo GIF for desktop and responsive layouts. |

### Acceptance Criteria

- README links resolve and no longer reference Kernul OS Dashboard.
- Quick start, scripts, stack, project structure, customization, roadmap, contribution, security, and license sections use Bun commands.
- Screenshots are committed or README avoids screenshot claims until media exists.

## Community

| ID | Status | Priority | Owner | Task |
| --- | --- | --- | --- | --- |
| AETH-011 | Done | P0 | Community | Add `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md`. |
| AETH-012 | Done | P1 | Community | Add GitHub issue forms for bug reports and feature requests. |
| AETH-013 | Done | P1 | Community | Add a pull request template with screenshots, checks, and release-risk prompts. |
| AETH-014 | Backlog | P2 | Community | Convert this TODO into labeled GitHub issues after the first push. |

### Acceptance Criteria

- GitHub community files are present in recognized locations.
- Contribution docs require `bun run lint` and `bun run build`.
- Security reporting avoids public vulnerability disclosure.

## Quality

| ID | Status | Priority | Owner | Task |
| --- | --- | --- | --- | --- |
| AETH-015 | Done | P1 | Quality | Add GitHub Actions for Bun install, type-check, build, and dependency audit. |
| AETH-016 | Done | P1 | Quality | Run and record release verification: lint, build, residue search, and git status. |
| AETH-017 | Done | P2 | Quality | Replace broad `any` props in reusable components with typed interfaces. |
| AETH-018 | Done | P2 | Quality | Remove unused imports and clean minor TypeScript warnings. |

### Acceptance Criteria

- `bun run lint` and `bun run build` pass locally.
- Residue search for `Google`, `AI Studio`, `Gemini`, `GEMINI`, `APP_URL`, `react-example`, `package-lock`, and `npm` returns no unintended hits outside the playbook/history.
- CI runs the same checks on pull requests and pushes to `main`.

## UX and Accessibility

| ID | Status | Priority | Owner | Task |
| --- | --- | --- | --- | --- |
| AETH-019 | Done | P1 | UX | Audit keyboard navigation, focus states, and button labels across the dashboard shell. |
| AETH-020 | Done | P1 | UX | Add accessible names to icon-only controls and panel close buttons. |
| AETH-021 | Backlog | P2 | UX | Verify mobile drawer and AURA panel behavior with browser screenshots. |
| AETH-022 | Backlog | P2 | UX | Review chart color contrast, tooltip readability, and reduced-motion behavior. |

### Acceptance Criteria

- Icon-only buttons have discoverable accessible labels or text alternatives.
- Mobile overlays can be opened and closed with pointer and keyboard flows.
- Visual changes are verified on desktop and mobile viewports.

## Performance and Deployment

| ID | Status | Priority | Owner | Task |
| --- | --- | --- | --- | --- |
| AETH-023 | Done | P1 | Performance | Review bundle size and Vite build output after dependency pruning. |
| AETH-024 | Backlog | P2 | Performance | Decide whether Google Fonts should be self-hosted or left as external runtime fetches. |
| AETH-025 | Done | P1 | Deployment | Add production HTML metadata: title, description, theme color, favicon, and social preview plan. |
| AETH-026 | Backlog | P2 | Deployment | Add repository topics and enable GitHub repository features after push. |

### Acceptance Criteria

- Production build has no unexpected generated app metadata.
- Bundle warnings are either resolved or tracked with rationale.
- Repo settings and topics match the project identity after the first GitHub push.
