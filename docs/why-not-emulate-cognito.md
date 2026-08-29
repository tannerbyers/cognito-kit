# Why not emulate Cognito locally?

This is a central design decision for cognito-kit. It deserves a section of
its own.

## Cognito is managed infrastructure

Amazon Cognito is a fully managed service. Its behavior is a moving target:
AWS ships new features, changes defaults, and does not document every edge
case. A faithful emulator would need to track all of that — permanently. That
is a full-time project of its own, and it is not the problem we are solving.

## Applications should depend on OIDC/JWT behavior, not Cognito internals

Cognito is, at its heart, an OpenID Connect provider. The contract your
application actually consumes is:

- OIDC discovery
- JWKS
- authorization code flow + PKCE
- token endpoint
- userinfo
- logout
- RS256-signed JWTs with `sub`, `email`, `email_verified`

That contract is standardized. A small, standards-based local server can
satisfy it faithfully for development purposes, and Cognito satisfies it in
production. If your application depends only on this contract — which
cognito-kit's runtime package enforces — then it works identically in both
environments, and it is portable to any other OIDC provider later.

## Infrastructure correctness is tested through generated CloudFormation

The part of Cognito that is _configuration_, not behavior, is fully captured
by the CDK construct. `cdk synth` produces deterministic CloudFormation that
is verified by:

- assertion tests (`UsernameConfiguration.CaseSensitive = false`, OAuth flows,
  callback URLs, token settings, secret behavior, deletion protection, schema)
- committed CloudFormation snapshots

This is exact — the template is the truth — and it runs with zero AWS
credentials.

## AWS behavior is verified separately

The one thing we cannot verify locally is how the real AWS service behaves.
That is handled by an explicit, optional test layer gated behind
`COGNITO_KIT_AWS_TESTS=1`, which is not part of normal CI. Eventually it
deploys a temporary stack, exercises real Cognito flows, and destroys the
stack.

## What this means for you

- `pnpm test` runs entirely offline.
- Your app's auth code is exercised against a real HTTP OIDC server locally.
- Your infrastructure is proven by synthesis, not by hope.
- Real AWS behavior is verified deliberately, once, when you choose to.

Emulation would give you a false sense of fidelity at enormous cost. Standards
give you the same development experience with a real contract.
