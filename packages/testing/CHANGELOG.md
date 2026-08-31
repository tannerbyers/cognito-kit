# @cognito-kit/testing

## 1.0.0

### Major Changes

- 4843471: Initial release: local-first Cognito developer toolkit.

### Minor Changes

- a2efe1c: doctor improvements, versioned config, extensible rules.

  - `cognito-kit doctor --demo` diagnoses a built-in bad pool (offline)
  - `cognito-kit doctor --format json` and `--fail-on <severity>` for CI gates
  - `defineAuth({ schemaVersion: 1 })` adds a config migration path
  - `defineRule` + `diagnoseWithRules` make the rules engine extensible
  - real-AWS smoke test fixes: account id resolution, public test client,
    deterministic stack naming via CK_TEST_STACK

### Patch Changes

- Updated dependencies [a2efe1c]
- Updated dependencies [4843471]
  - @cognito-kit/core@1.0.0
  - @cognito-kit/runtime@1.0.0
