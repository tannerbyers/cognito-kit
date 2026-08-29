# cognito-kit

> **Cognito without learning Cognito.**

A free, local-first developer toolkit for Amazon Cognito. It creates safe,
opinionated Cognito infrastructure, prevents common configuration mistakes,
gives you a clean local development environment, diagnoses existing
configurations, and minimizes Cognito lock-in — all without requiring an AWS
account during development.

This is **not** a replacement authentication provider and **not** a hosted
SaaS product. It is a developer tool. Eventually it deploys everything into
your own AWS account.

## Quick start (under 5 minutes)

```bash
pnpm add cognito-kit
npx cognito-kit init
npx cognito-kit dev
```

`init` generates a starter configuration in `./auth/`. `dev` starts a local
OpenID Connect / OAuth2 server that your application authenticates against —
using the exact same contract you will consume from Cognito in production.

## Architecture

```
Development                      Production

Application                       Application
    ↓                                 ↓
Local OIDC Server               Amazon Cognito
```

The application-facing authentication contract is identical in both
environments:

- OIDC discovery
- JWKS endpoint
- authorization code flow + PKCE
- token endpoint
- userinfo
- logout
- RS256-signed JWTs with normalized claims (`sub`, `email`, `email_verified`)

Your application validates tokens with `@cognito-kit/runtime` and consumes a
normalized `AuthenticatedUser` — it never cares whether the token came from
local-auth, Cognito, or another OIDC provider later.

## Why not emulate Cognito locally?

- **Cognito is managed infrastructure.** Its behavior is a moving target and
  is not fully documented. Perfect emulation is unrealistic and would be a
  full-time project of its own.
- **Applications should depend on OIDC/JWT behavior, not Cognito internals.**
  If your app works against a standards-based local server and against
  Cognito, you are portable by construction.
- **Infrastructure correctness is tested through generated CloudFormation.**
  The CDK construct synthesizes safe, deterministic templates that are
  verified by assertions and snapshots — no AWS needed.
- **AWS behavior is verified separately** with optional real-AWS integration
  tests (`COGNITO_KIT_AWS_TESTS=1`), explicitly out of normal CI.

See [docs/why-not-emulate-cognito.md](docs/why-not-emulate-cognito.md) for the
full rationale.

## The configuration model

You do not configure Cognito. You describe your app:

```ts
// auth/auth.config.ts
import { defineAuth } from "@cognito-kit/core"

export default defineAuth({
  signIn: "email",

  application: {
    type: "web",
    callbackUrls: ["http://localhost:3000/auth/callback", "https://app.example.com/auth/callback"],
    logoutUrls: ["http://localhost:3000", "https://app.example.com"],
  },
})
```

cognito-kit translates this into safe Cognito configuration:

- case-insensitive email identities
- Cognito `sub` as the canonical, immutable identity
- email verification required
- authorization code flow with PKCE
- secure token lifetimes (60 min ID/access, 30 day refresh)
- no unnecessary required attributes
- **no custom attributes** by default
- email account recovery
- deletion protection
- secure app client defaults (secrets for confidential web apps only)
- Managed Login on a hosted domain
- safe callback/logout URL validation

Core philosophy:

> **Cognito stores identity. The application stores user/profile data.**

Do not store roles, subscriptions, organization data, preferences,
application state, billing state, or onboarding state in Cognito custom
attributes. The `doctor` command will warn you if you do.

## CLI

```bash
cognito-kit init     # generate a starter configuration (non-interactive first)
cognito-kit doctor   # diagnose a Cognito configuration (fully offline)
cognito-kit dev      # run the local OIDC server
cognito-kit test     # validate your auth configuration
cognito-kit migrate  # planned — migration analysis
cognito-kit deploy   # planned — deploy into your AWS account
```

### doctor

```bash
cognito-kit doctor --file ./tests/fixtures/bad-pool.json
```

```
Cognito User Pool

✓ Case-insensitive email
✓ Cognito sub used as canonical identity
✓ Email verification enabled
✓ OAuth authorization code flow enabled
✓ Callback URLs valid

⚠ 4 custom attributes detected
  Custom attributes cannot easily be removed later.
  Prefer storing application profile data in your database.

✗ Email usernames are case sensitive
  This can create duplicate/logically equivalent identities.
  → Use email aliases with case-insensitive matching.

Summary: 8 passed, 5 warnings, 3 critical
```

The diagnostics engine (`diagnoseUserPool`) is pure and AWS-free. It accepts a
normalized plain-object pool configuration, so it works with local fixture
files today and with real AWS state tomorrow.

## Packages

| Package                       | Purpose                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `@cognito-kit/core`           | Config model, safe defaults, validation, normalization, diagnostics, control-plane interface + fake |
| `@cognito-kit/runtime`        | Tiny JWT verification + normalized `AuthenticatedUser`                                              |
| `@cognito-kit/local-auth`     | Local OIDC/OAuth2 development server                                                                |
| `@cognito-kit/infrastructure` | CDK constructs that synthesize safe Cognito CloudFormation                                          |
| `@cognito-kit/testing`        | Test helpers: tokens, users, issuers, fake control plane                                            |
| `cognito-kit`                 | The CLI                                                                                             |

## Test layers

| Layer          | Command                 | What it proves                                                     |
| -------------- | ----------------------- | ------------------------------------------------------------------ |
| Unit           | `pnpm test:unit`        | Config, defaults, validation, diagnostics, JWT logic, CLI logic    |
| Contract       | `pnpm test:contract`    | Local and Cognito-compatible tokens satisfy the same contract      |
| Integration    | `pnpm test:integration` | Full local OIDC flow over HTTP (discovery → login → PKCE → tokens) |
| Infrastructure | `pnpm test:infra`       | CDK synthesis, assertions, CloudFormation snapshots                |
| E2E            | `pnpm test:e2e`         | Next.js + Node API examples authenticate against `cognito-kit dev` |
| AWS            | `pnpm test:aws`         | Optional, gated behind `COGNITO_KIT_AWS_TESTS=1` — not in CI       |

All layers except AWS run with **zero AWS credentials, zero Docker, zero
network**.

## Development

```bash
pnpm install
pnpm test          # unit + contract + integration + infra
pnpm dev           # local auth server + Node API example + live login demo
```

See [docs/architecture.md](docs/architecture.md) for the full design.

## License

Apache-2.0
