---
"@cognito-kit/core": minor
"@cognito-kit/runtime": minor
"@cognito-kit/local-auth": minor
"@cognito-kit/infrastructure": minor
"@cognito-kit/testing": minor
"@cognito-kit/aws": minor
"cognito-kit": minor
---

doctor improvements, versioned config, extensible rules.

- `cognito-kit doctor --demo` diagnoses a built-in bad pool (offline)
- `cognito-kit doctor --format json` and `--fail-on <severity>` for CI gates
- `defineAuth({ schemaVersion: 1 })` adds a config migration path
- `defineRule` + `diagnoseWithRules` make the rules engine extensible
- real-AWS smoke test fixes: account id resolution, public test client,
  deterministic stack naming via CK_TEST_STACK