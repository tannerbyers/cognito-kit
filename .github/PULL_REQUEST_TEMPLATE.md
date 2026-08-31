## What does this change?

<!-- One or two sentences. If it fixes an issue, say "Fixes #NNN". -->

## Is this a new diagnostic rule?

- [ ] Yes — the rule is added to `DIAGNOSTIC_RULES` in `packages/core/src/diagnose.ts`
- [ ] Yes — behavior tests added in `packages/core/src/diagnose.test.ts`
- [ ] No

## Checklist

- [ ] `pnpm check` passes (typecheck + lint + unit + contract + infra + integration)
- [ ] `pnpm test:e2e` passes
- [ ] `pnpm test:aws:local` passes (if AWS adapter touched)
- [ ] Changeset added (`pnpm changeset`) for user-facing changes
- [ ] Docs regenerated (`pnpm docs:generate`) if public API changed

## Breaking changes?

<!-- Any public API, config schema, CLI flag, package name, or rule id change. -->