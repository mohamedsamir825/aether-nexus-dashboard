# NEXUS

A Personal Intelligence & Execution System, built to grow into a Business/Executive OS.

**Status: Phases 1–5 foundation complete.** The Core, two provider adapters,
rate-limit and quota aware routing, the first real tool, and the first real
Division (Research) all exist. No other divisions and no UI wiring — that is
deliberate, not incomplete work. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what
comes next and what is intentionally deferred.

## What is here

```txt
packages/core/       The Core: contracts, registries, runtime primitives. Zero dependencies.
packages/providers/  Model provider adapters (OpenAI-compatible, Google Gemini).
packages/tools/      Tools agents can invoke (arithmetic).
packages/divisions/  Divisions (research). See docs/RESEARCH_DIVISION.md.
apps/dashboard/      A vendored third-party dashboard template. NOT wired to Core.
docs/                Architecture, decision records, roadmap, design references.
```

## Quick start

```bash
bun install
bun test packages # 368 tests, no network, no credentials, zero API cost
bun run health    # honest system status; exits non-zero while unavailable
bun run demo      # one task across every layer, end to end
```

`bun run health` reports `unavailable` until a provider adapter is registered with
a credential. That is the correct answer, not a failure: the system says it cannot
serve model calls rather than discovering that at the first request. Add a free API
key to `.env` and register the matching adapter — **nothing in the Core changes**,
which is the point of ADR 0004.

## Scripts

```bash
bun test               # Core test suite
bun run typecheck      # Type-check every package
bun run health         # Print a JSON health report
bun run dashboard:dev  # Run the vendored template (unrelated to Core)
```

## Configuration

Copy `.env.example` to `.env` and fill in only what you use. Nothing is required
to run the foundation. Secrets live in `.env` (git-ignored) and are never logged:
the only supported way to render configuration is `describeConfig`, which reports
credential *presence*, never values. This is enforced by tests, not by convention.

## Architecture

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — it describes what the
Core actually does today. [`docs/NEXUS_MASTER_SPEC.md`](docs/NEXUS_MASTER_SPEC.md)
is the full long-term product specification, including a gap analysis of what the
foundation still lacks. Decisions and their trade-offs are recorded in
[`docs/adr/`](docs/adr/).

The short version: a Supervisor coordinates specialised agents grouped into
divisions. Agents own skills, reach the world only through permission-checked
tools, and talk to models only through a router that hides the vendor. Agents
never import each other — collaboration goes through the Supervisor.

## License

MIT. See [LICENSE](LICENSE). `apps/dashboard/` is third-party work by
[bymilon](https://github.com/bymilon), retained under the same license.
