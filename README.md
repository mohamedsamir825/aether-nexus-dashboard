# NEXUS

A Personal Intelligence & Execution System, built to grow into a Business/Executive OS.

**Status: engineering foundation only.** The Core contracts, registries, permission
model, provider-agnostic model layer, and test infrastructure exist. No divisions,
no agents, no tools, no UI wiring, and no provider adapters exist yet — that is
deliberate, not incomplete work. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what
comes next and what is intentionally deferred.

## What is here

```txt
packages/core/     The Core: contracts, registries, runtime primitives. Zero runtime dependencies.
apps/dashboard/    A vendored third-party dashboard template. NOT wired to Core. See its README.
docs/              Architecture, decision records, and roadmap.
```

## Quick start

```bash
bun install
bun test          # 78 tests, no network, no credentials
bun run health    # honest system status; exits non-zero while unavailable
```

`bun run health` currently reports `unavailable`. That is the correct answer: no
model provider adapters are registered, so the system says it cannot serve model
calls rather than discovering that at the first request.

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

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first. Decisions and their
trade-offs are recorded in [`docs/adr/`](docs/adr/).

The short version: a Supervisor coordinates specialised agents grouped into
divisions. Agents own skills, reach the world only through permission-checked
tools, and talk to models only through a router that hides the vendor. Agents
never import each other — collaboration goes through the Supervisor.

## License

MIT. See [LICENSE](LICENSE). `apps/dashboard/` is third-party work by
[bymilon](https://github.com/bymilon), retained under the same license.
