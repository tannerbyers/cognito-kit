# Architecture

## Goals

1. **AWS APIs live behind interfaces/adapters.** Core logic never imports AWS
   SDK clients.
2. **Everything meaningful must be usable and testable without an AWS
   account.** AWS integration tests are a separate, optional layer.
3. **One normalized auth contract** shared by local development and production
   Cognito.

## Package boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  cognito-kit (CLI)                                          │
│  init · doctor · dev · test · migrate* · deploy*            │
└───────┬──────────────┬───────────────┬──────────────────────┘
        │              │               │
        ▼              ▼               ▼
┌──────────────┐ ┌───────────────┐ ┌──────────────────┐
│ @cognito-kit │ │ @cognito-kit  │ │ @cognito-kit     │
│ /core        │ │ /local-auth   │ │ /infrastructure  │
│              │ │               │ │                  │
│ config model │ │ local OIDC    │ │ CDK construct    │
│ normalize    │ │ server        │ │ → CloudFormation │
│ diagnostics  │ │ (no AWS)      │ │ (no deploy)      │
│ control-plane│ │               │ │                  │
│ interface    │ │               │ │                  │
└──────────────┘ └───────────────┘ └──────────────────┘
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
               ┌──────────────────┐
               │ @cognito-kit     │
               │ /runtime         │
               │ JWT verify       │
               │ normalize user   │
               └──────────────────┘
                       ▲
                       │
               ┌──────────────────┐
               │ @cognito-kit     │
               │ /testing         │
               │ tokens, users,   │
               │ fakes            │
               └──────────────────┘
```

### Dependency rules

- `@cognito-kit/core` depends on **nothing** (zero runtime deps). AWS SDK is
  never imported here.
- `@cognito-kit/runtime` depends only on `jose`.
- `@cognito-kit/local-auth` depends only on `jose` (Node built-ins otherwise).
- `@cognito-kit/infrastructure` depends on `aws-cdk-lib` + `constructs` +
  `@cognito-kit/core`. It synthesizes templates; it never deploys.
- `@cognito-kit/testing` depends on core + runtime + `jose`.
- `cognito-kit` (CLI) depends on core + local-auth + commander + jiti.

## The control-plane abstraction

Core logic talks to Cognito through interfaces, never through the AWS SDK:

```ts
interface CognitoControlPlane {
  describeUserPool(id: string): Promise<UserPoolInfo>
  describeUserPoolClient(poolId: string, clientId: string): Promise<UserPoolClientInfo>
  listUserPools(): Promise<UserPoolSummary[]>
  listUserPoolClients(poolId: string): Promise<...>
}
```

Implementations:

- `FakeCognitoControlPlane` — deterministic, offline, supports injected
  failures (not-found, throttling, malformed, api-failure).
- `AwsCognitoControlPlane` — a future adapter wrapping the AWS SDK, kept out
  of the core dependency graph.

This is what lets `doctor`, validation and future migration analysis run
completely locally against fixture data.

## The normalized pool document

The single contract shared by config, diagnostics, CDK and fixtures:

```ts
interface NormalizedPoolConfig {
  formatVersion: 1
  provider: "cognito"
  usernameConfiguration: { caseSensitive: boolean }
  signIn: { email: boolean; username: boolean; phone: boolean }
  verification: { email: "required" | "optional" | "disabled"; ... }
  requiredAttributes: string[]
  customAttributes: NormalizedCustomAttribute[]
  appClient: NormalizedAppClient
  accountRecovery: { enabled: boolean; methods: AccountRecoveryMethod[] }
  infrastructure: { provisionedBy: ...; deletionProtection: boolean; reproducible: boolean }
  application: { identity: "cognito_sub" | "email" | ...; storesProfileDataInCognito: boolean }
  ...
}
```

Producers:

- `normalizeConfig(config)` — developer config → normalized document
- future `AwsCognitoControlPlane` adapters — AWS SDK response → normalized
  document

Consumers:

- `diagnoseUserPool(normalized)` — the diagnostics engine
- the CDK construct — synthesizes CloudFormation
- `cognito-kit doctor --file fixtures/*.json`

## The diagnostics engine

Pure functions over the normalized document. Each rule:

```ts
{
  id: string
  severity: "warning" | "critical"
  title: string
  explanation: string
  recommendation: string
  docsUrl?: string
  check(pool): DiagnosticFinding[]
}
```

Rules are independently unit-tested. See [diagnostics.md](./diagnostics.md).

## The local auth server

`@cognito-kit/local-auth` is **not** a Cognito emulator. It is a small,
standards-based OIDC/OAuth2 development server:

- `/.well-known/openid-configuration`
- `/.well-known/jwks.json`
- `/authorize` (authorization code flow, PKCE S256)
- `/login` (HTML form)
- `/token` (authorization_code + refresh_token grants)
- `/userinfo`
- `/logout`

Tokens are RS256-signed with an ephemeral (or persisted) dev key and carry
normalized claims: `sub`, `email`, `email_verified`, plus per-user custom
claims.

## The runtime contract

`@cognito-kit/runtime` provides:

- `createTokenVerifier({ issuer, jwks, audience })` — static JWKS
- `createRemoteTokenVerifier({ issuer, jwksUrl, audience })` — cached remote JWKS
- `normalizeUser(claims)` → `AuthenticatedUser { id, email, emailVerified, claims }`
- `discoverIssuer(url)` — OIDC discovery
- session cookie helpers

Applications depend on `AuthenticatedUser` and the JWT contract — never on
provider internals. Contract tests prove local and Cognito-compatible tokens
produce identical normalized users.

## Infrastructure synthesis

`CognitoKitAuth` is a CDK L2 construct that consumes the same normalized
document and emits:

- `AWS::Cognito::UserPool` with safe defaults
- `AWS::Cognito::UserPoolClient` (authorization code flow, exact URLs, secret
  policy, token validity)
- `AWS::Cognito::UserPoolDomain` (Managed Login)
- stack outputs (pool id, client id, issuer, domain)

No environment lookups (`Vpc.fromLookup`, `HostedZone.fromLookup`, …) are
used, so `cdk synth` and the test suite never require AWS credentials. All
values are accepted explicitly.

## Test layers

1. **Unit** — no network, no Docker, no AWS. Config, defaults, validation,
   diagnostics, JWT logic, CLI business logic, URL rules.
2. **Contract** — no AWS. Local and Cognito-compatible tokens produce
   identical normalized users.
3. **Integration** — no AWS. Spins up the real local OIDC server and drives
   the complete flow over HTTP.
4. **Infrastructure** — no AWS. CDK synthesis, assertions, deterministic
   CloudFormation snapshots.
5. **E2E** — examples authenticate against `cognito-kit dev`.
6. **AWS** — optional, `COGNITO_KIT_AWS_TESTS=1`, not in CI.

## Future extension points

- `cognito-kit migrate` — Cognito → Cognito and away-from-Cognito analysis
- SAML / OIDC federation, Google/social providers
- SES, custom domains, MFA, passkeys
- Multi-Region replication, backups
- Terraform output
- existing-pool import (via the control-plane adapter)

These are deliberately not implemented in V1. The boundaries (control-plane
interface, normalized document, diagnostics engine) are the extension points.
