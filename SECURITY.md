# Security

Please do not report security vulnerabilities through public GitHub issues.

Report suspected vulnerabilities by opening a private GitHub security advisory if
the repository has that feature enabled, or by contacting the maintainer through
the GitHub profile listed on the repository.

Include:

- Affected files or behavior.
- Steps to reproduce.
- Expected impact.
- Any suggested fix or mitigation.

## Handling secrets in this repository

- This repository must never contain API keys, tokens, or credentials.
- Real values belong in `.env`, which is git-ignored. `.env.example` is a
  committed template and must contain no real values.
- Configuration is rendered only via `describeConfig`, which reports whether a
  credential is present and never its value. Tests assert that health output and
  configuration summaries contain no key material.
- CI runs a credential-shaped-string scan and verifies that no `.env` file is
  tracked. That scan is a backstop, not a substitute for care.

If you believe a credential has been committed, treat it as compromised: rotate
it first, then report.
