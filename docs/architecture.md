# Architecture

## Rules

1. AWS APIs live behind interfaces. Core logic never imports AWS SDK clients.
2. Everything runs without an AWS account. AWS tests are a separate optional layer.
3. One normalized auth contract for local development and production Cognito.

## Packages

| Package | Responsibility |
| --- | --- |
| `@cognito-kit/core` | Config model, normalization, validation, diagnostics, migration analysis, control-plane interface + fake |
| `@cognito-kit/runtime` | JWT verification, normalized `AuthenticatedUser`, issuer discovery, session cookies |
| `@cognito-kit/local-auth` | Local OIDC/OAuth2 dev server (not a Cognito emulator) |
| `@cognito-kit/infrastructure` | CDK constructs that synthesize safe Cognito CloudFormation |
| `@cognito-kit/testing` | Test helpers: tokens, users, issuers, fake control plane |
| `@cognito-kit/aws` | AWS adapter: real control plane + normalized conversion (lazy SDK load) |
| `cognito-kit` | CLI |

## Dependency rules

| Package | Depends on |
| --- | --- |
| core | nothing (zero runtime deps) |
| runtime | jose |
| local-auth | jose |
| infrastructure | aws-cdk-lib, constructs, core |
| testing | core, runtime, jose |
| aws | core, aws-sdk (lazy-loaded) |
| cli | core, local-auth, commander, jiti (+ optional aws) |

## Data flow

`defineAuth(config)` → `normalizeConfig` → `NormalizedPoolConfig` (plain JSON).

Consumers of `NormalizedPoolConfig`: `diagnoseUserPool`, `analyzeMigration`, the CDK construct, `doctor --file`.

The AWS adapter converts AWS SDK responses into `NormalizedPoolConfig` via `toNormalizedPool`, so `doctor --pool` uses the same rules as local fixtures.

## Test layers

| Layer | Command | Requires |
| --- | --- | --- |
| Unit | `pnpm test:unit` | none |
| Contract | `pnpm test:contract` | none |
| Infra | `pnpm test:infra` | none |
| Integration | `pnpm test:integration` | none |
| E2E | `pnpm test:e2e` | local-auth + examples |
| AWS (local emulator) | `pnpm test:aws --local` | Docker (cognito-local) |
| AWS (real) | `pnpm test:aws` | `COGNITO_KIT_AWS_TESTS=1` + AWS account |

The local emulator mode (`--local`) runs the same auth flow and runtime
contract against cognito-local (a free Cognito emulator) and exercises the
AWS adapter against a real HTTP API. It does not exercise CloudFormation
deployment or actual Cognito behavior — those are real-AWS-only.