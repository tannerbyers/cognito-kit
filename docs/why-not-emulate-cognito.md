# Why not emulate Cognito locally?

1. **Cognito is managed infrastructure.** Its behavior changes and is not fully documented. Emulation is a permanent, full-time project.
2. **Applications should depend on OIDC/JWT behavior, not Cognito internals.** A standards-based local server satisfies the same contract.
3. **Infrastructure correctness is proven by generated CloudFormation** (assertions + snapshots), not by emulation.
4. **Real AWS behavior is verified separately** by the optional `COGNITO_KIT_AWS_TESTS=1` layer, outside normal CI.

Consequence: `pnpm test` runs fully offline; application auth code runs against a real HTTP OIDC server locally; infrastructure is proven by synthesis.