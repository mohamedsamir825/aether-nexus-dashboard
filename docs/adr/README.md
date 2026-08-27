# Architecture Decision Records

One file per decision that would be expensive to reverse. Format: context, the
decision, consequences, and what would make us revisit it.

A change that contradicts an accepted ADR needs a new ADR superseding it — not a
silent edit.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-typescript-core-on-bun.md) | TypeScript Core on Bun, zero dependencies | Accepted |
| [0002](0002-monorepo-workspaces.md) | Bun workspaces monorepo | Accepted |
| [0003](0003-quarantine-dashboard-template.md) | Quarantine the vendored dashboard template | Accepted |
| [0004](0004-provider-agnostic-model-layer.md) | Provider-agnostic model layer | Accepted |
| [0005](0005-deny-by-default-permissions.md) | Deny-by-default permissions | Accepted |
| [0006](0006-result-over-exceptions.md) | Result values over exceptions | Accepted |
| [0007](0007-supervisor-is-not-a-planner.md) | The Supervisor is not a planner | Accepted |
| [0008](0008-async-authorization-broker.md) | Asynchronous authorization broker (resolves C1) | Accepted |
| [0009](0009-speech-provider-contract.md) | SpeechProvider is a sibling contract (resolves C2) | Accepted |
| [0010](0010-user-intelligence-before-learning.md) | User Intelligence precedes Learning (resolves C3) | Accepted |
| [0011](0011-free-tier-provider-strategy.md) | Free-tier-only providers, two-adapter pattern | Accepted |
| [0012](0012-command-center-design-direction.md) | Command Center design direction | Accepted |
| [0013](0013-claim-and-division-contracts.md) | Claim and Division as Core contracts | Accepted |
| [0014](0014-verification-confidence.md) | `VerificationResult` carries a confidence (§19.1) | Accepted |
| [0015](0015-http-source-retriever.md) | A native HTTP `SourceRetriever` | Accepted |
