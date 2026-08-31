# Contributing

Thanks for improving cognito-kit. Apache-2.0, all contributions welcome.

## Know a Cognito trap? Add a rule.

The diagnostics engine is extensible. Each rule is one file plus tests.

1. Look at `packages/core/src/diagnose.ts` for the rule shape.
2. Find an unused id in the `ck-*` series.
3. Add the rule to `DIAGNOSTIC_RULES` and export it.
4. Add behavior tests in `packages/core/src/diagnose.test.ts` (use `tests/fixtures/`).
5. Run `pnpm check && pnpm build` and open a PR.

Your rule must answer: what the problem is, why it matters, and the exact fix.

## Setup

```bash
pnpm install
pnpm check        # typecheck + lint + unit + contract + infra + integration
pnpm test:e2e     # full example flows
pnpm test:aws:local  # emulator-based AWS flow (no AWS account)
```

## Commands

- `pnpm dev` — local OIDC server + Node API demo
- `pnpm docs:generate` — regenerate API/CLI/diagnostics docs from code
- `pnpm changeset` — add a changeset for release (required for user-facing changes)

## Conventions

- TypeScript strict, `node:` imports, no runtime deps in a package unless required.
- AWS APIs live behind interfaces; core never imports the AWS SDK.
- Tests are behavioral; prefer "prevents X" over "calls function X once".
- No telemetry, no user accounts, no visual polish scope creep.

## AWS tests

Normal CI never touches AWS. The emulator layer (`pnpm test:aws --local`)
runs against cognito-local. Real-AWS tests (`pnpm test:aws`) must be gated
behind `COGNITO_KIT_AWS_TESTS=1` and destroy everything they deploy.

## Releasing

1. Merge changesets-containing PRs.
2. The release workflow opens a "Version packages" PR on main.
3. Merge it; the workflow publishes to npm with provenance.