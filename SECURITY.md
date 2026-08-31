# Security

## Reporting a vulnerability

Do not open a public issue for security problems.

Report privately to the maintainers at **tanner@decoupledev.com**. Include:

- affected versions
- reproduction steps (configuration, commands)
- impact

You will get an acknowledgement within 72 hours and a fix plan within 7 days.

## Scope

- `@cognito-kit/*` and `cognito-kit` packages.
- Generated CloudFormation defaults.
- The local-auth development server. It is for local development only and
  must never be deployed as a production authentication service.

## Out of scope / by design

- `cognito-kit dev` and `@cognito-kit/local-auth` store passwords in plain
  text (test fixtures). Production auth is Amazon Cognito.
- The JWKS keys of the local auth server are ephemeral/per-dev only.

## Process

1. Report received, triaged.
2. Fix prepared in a private branch.
3. Release + public disclosure.