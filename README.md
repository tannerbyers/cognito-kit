# cognito-kit

Cognito without learning Cognito.

Local-first toolkit for Amazon Cognito: safe opinionated infrastructure, local development auth, configuration diagnostics. Not a replacement auth provider. Not SaaS. Deploys into your own AWS account.

## Quick start

```bash
pnpm add cognito-kit
npx cognito-kit init
npx cognito-kit dev
```

## Architecture

```
Development                Production
Application               Application
    ↓                          ↓
Local OIDC Server      Amazon Cognito
```

Same application-facing contract: OIDC discovery, JWKS, authorization code + PKCE, tokens, userinfo, logout, RS256 JWTs with `sub` / `email` / `email_verified`.

## Commands

| Command | Purpose |
| --- | --- |
| `cognito-kit init` | Generate starter config |
| `cognito-kit doctor` | Diagnose a Cognito config (offline) |
| `cognito-kit dev` | Run local OIDC server |
| `cognito-kit test` | Validate your config |

```bash
npx cognito-kit doctor --file ./tests/fixtures/bad-cognito.json
```

## Docs

- [API reference](docs/generated/api/index.html)
- [CLI commands](docs/generated/commands.md)
- [Diagnostics rules](docs/generated/diagnostics.md)
- [Architecture](docs/architecture.md)
- [Why not emulate Cognito locally?](docs/why-not-emulate-cognito.md)

Docs are generated from code by `pnpm docs:generate` (TypeDoc + `scripts/generate-docs.mjs`).

## Development

```bash
pnpm install
pnpm test
pnpm dev
```

## License

Apache-2.0