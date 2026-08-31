# Cognito Kit

**Cognito without learning Cognito.**

Deploy safe, opinionated Amazon Cognito from a 10-line config. Diagnose your existing pools. Run a real local OIDC server. All before you touch AWS.

```bash
$ npx cognito-kit doctor --demo

✗ Email usernames are case sensitive
  This can create duplicate/logically equivalent identities.
  → Use email aliases with case-insensitive matching.
✗ Custom attributes detected (4)
  Custom attributes cannot easily be removed later.
  → Store profile data in your database.
✗ Implicit OAuth flow is enabled
  ...
Summary: 8 passed, 5 warnings, 3 critical
```

## 30-second demo

```bash
npx cognito-kit doctor --demo          # diagnose a deliberately bad pool (offline)
npx cognito-kit doctor --format json   # same report, CI-friendly
npx cognito-kit doctor --file ./my-pool.json
```

## Why it exists

Cognito has hundreds of settings and a dozen ways to hurt yourself. Most apps
need the same safe subset. cognito-kit encodes that subset and prevents the
rest.

**It prevents:**

- case-sensitive email identities → duplicate accounts
- custom attributes storing app data → un-migratable pools
- implicit OAuth flows → leaked tokens
- missing email verification → account takeover
- secure token, callback, recovery and deletion-protection mistakes

**What it is not:** a replacement auth provider, a hosted product, an
emulator. It builds real Cognito infrastructure, in your account, on your
terms.

## Local-first

```
Development                Production
Application               Application
    ↓                          ↓
Local OIDC Server      Amazon Cognito
```

Same OIDC contract in both: discovery, JWKS, authorization code + PKCE,
tokens, userinfo, logout. Verify once with `@cognito-kit/runtime`; run it
against `cognito-kit dev` locally and Cognito in production.

No AWS account needed for normal development. The full test suite runs
offline. A real-AWS smoke test (`COGNITO_KIT_AWS_TESTS=1`) verifies the
synthesized stack once.

## Install

```bash
pnpm add cognito-kit
npx cognito-kit init        # generates auth/auth.config.ts + auth/users.ts
npx cognito-kit dev         # local OIDC server on :9876
```

That's the whole config surface:

```ts
// auth/auth.config.ts
import { defineAuth } from "@cognito-kit/core"

export default defineAuth({
  schemaVersion: 1,
  signIn: "email",
  application: {
    type: "web",
    callbackUrls: ["http://localhost:3000/auth/callback"],
    logoutUrls: ["http://localhost:3000"],
  },
})
```

Everything else — case-insensitive emails, `sub` identity, email
verification, auth-code + PKCE, token lifetimes, deletion protection, Managed
Login — is a safe default.

## Commands

| Command | Use |
| --- | --- |
| `cognito-kit doctor --demo` | See what could go wrong (offline) |
| `cognito-kit doctor --file pool.json` | Diagnose a documented pool |
| `cognito-kit doctor --pool <id>` | Diagnose a live AWS pool (read-only) |
| `cognito-kit doctor --format json --fail-on warning` | CI gate |
| `cognito-kit init` | Starter config + users |
| `cognito-kit dev` | Local OIDC server |
| `cognito-kit test` | Validate your config |
| `cognito-kit migrate --from a --to b` | Migration analysis (offline) |

## Packages

| Package | What it gives you |
| --- | --- |
| `cognito-kit` | The CLI |
| `@cognito-kit/core` | Config model, safe defaults, diagnostics, migration analysis |
| `@cognito-kit/runtime` | JWT verification + normalized `AuthenticatedUser` |
| `@cognito-kit/local-auth` | Local OIDC/OAuth2 server |
| `@cognito-kit/infrastructure` | CDK construct (`CognitoKitAuth`) |
| `@cognito-kit/testing` | `createTestToken`, fake control plane, and friends |
| `@cognito-kit/aws` | Read-only AWS adapter for `doctor --pool` |

## Real example

```ts
// infra/auth-stack.ts
new CognitoKitAuth(stack, "Auth", {
  signIn: "email",
  application: {
    type: "web",
    callbackUrls: ["https://app.example.com/auth/callback"],
    logoutUrls: ["https://app.example.com"],
  },
})
```

Verified by CDK assertions, committed CloudFormation snapshots, and a
one-shot real-AWS smoke test: deploy → create user → login → verify tokens →
destroy.

## Docs

- [API reference](docs/generated/api/index.html)
- [CLI commands](docs/generated/commands.md)
- [Diagnostics rules](docs/generated/diagnostics.md)
- [Architecture](docs/architecture.md)
- [Why not emulate Cognito locally?](docs/why-not-emulate-cognito.md)

## Test layers

| Command | Offline? | Proves |
| --- | --- | --- |
| `pnpm test` | ✅ | unit + contract + infra + integration (135 tests) |
| `pnpm test:e2e` | ✅ | Next.js + Node API against `cognito-kit dev` |
| `pnpm test:aws --local` | ✅ | full auth flow against a Cognito emulator |
| `pnpm test:aws` | ❌ | real Cognito, deploy → verify → destroy |

## License

Apache-2.0