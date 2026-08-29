# Diagnostics

`cognito-kit doctor` analyzes a normalized Cognito configuration and reports
dangerous or poor choices. The engine is pure and AWS-free; it runs on fixture
files today and on real AWS state (via the control-plane adapter) later.

## Rule reference

| ID                        | Severity | What it detects                                                                       |
| ------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `ck-email-case-sensitive` | critical | Email identities are case-sensitive, allowing duplicate logically-equivalent accounts |
| `ck-sub-identity`         | warning  | The app does not use Cognito `sub` as its canonical identity                          |
| `ck-email-as-identity`    | warning  | The app uses email as an immutable database ID                                        |
| `ck-email-verification`   | critical | Email verification is not enforced before sign-in                                     |
| `ck-custom-attributes`    | warning  | Custom attributes are defined (hard to remove later)                                  |
| `ck-required-attributes`  | warning  | More attributes are required than identity verification needs                         |
| `ck-implicit-flow`        | critical | The implicit OAuth flow is enabled (tokens in URL fragments)                          |
| `ck-password-flow`        | warning  | USER_PASSWORD_AUTH / client-credentials grants are enabled                            |
| `ck-callback-urls`        | critical | Callback/logout URLs are invalid or insecure                                          |
| `ck-wildcard-callback`    | critical | Callback URLs contain wildcards (Cognito requires exact matches)                      |
| `ck-token-duration`       | warning  | ID/access token lifetimes exceed 60 minutes                                           |
| `ck-account-recovery`     | warning  | Account recovery is disabled or admin-only                                            |
| `ck-client-visibility`    | warning  | Public/confidential client configuration is inconsistent                              |
| `ck-profile-storage`      | warning  | Application profile data is stored in Cognito attributes                              |
| `ck-no-iac`               | warning  | Infrastructure is not reproducible (console-configured)                               |
| `ck-lock-in`              | warning  | Configuration increases migration lock-in                                             |

## Each rule

### ck-email-case-sensitive

Case-sensitive email identities let the same person create multiple,
logically equivalent accounts (`Alice@example.com` vs `alice@example.com`).
Use email aliases with case-insensitive matching.

### ck-sub-identity

The `sub` claim is stable, opaque and globally unique. It is the correct
canonical identity. Treat `email` and `username` as lookups, not keys.

### ck-email-as-identity

Email addresses change and can be recycled. Using email as the canonical
application identity couples your database to a mutable value. Use `sub`.

### ck-email-verification

Unverified email addresses can be claimed by the wrong person. Require email
verification before sign-in completes.

### ck-custom-attributes

Custom Cognito attributes cannot easily be removed later, are awkward to
query, and encourage storing application data in the identity provider. Store
roles, preferences and subscriptions in your own database, keyed by `sub`.

### ck-required-attributes

Every required attribute is a sign-up blocker and a migration liability.
Require only the sign-in identifier (e.g. `email`).

### ck-implicit-flow

The implicit flow returns tokens in the URL fragment, leaking them into
browser history, referrer headers and logs. Use the authorization code flow
with PKCE.

### ck-password-flow

`USER_PASSWORD_AUTH` hands the password to the application and bypasses the
hosted UI, MFA and WebAuthn. Disable it unless you have a specific documented
need.

### ck-callback-urls

Invalid callback URLs (non-URLs, plain HTTP on non-localhost, non-https
schemes) are either broken or allow token leakage. Use exact `https://`
callbacks in production and `http://localhost` only in development.

### ck-wildcard-callback

Cognito requires exact callback URL matches. Wildcards are not supported and
indicate a misunderstanding that typically breaks login.

### ck-token-duration

Long-lived tokens amplify the blast radius of a leak and delay revocation.
Keep ID/access tokens at 60 minutes or less and use refresh tokens for longer
sessions.

### ck-account-recovery

Without recovery, users who lose their password are locked out. Enable
email-based account recovery rather than admin-only recovery.

### ck-client-visibility

A confidential (web) client without a secret, or a public (SPA/mobile) client
with a secret, signals a misunderstanding of the OAuth client model.

### ck-profile-storage

Storing application profile data in Cognito attributes couples identity to
business state and makes migration painful. Cognito stores identity; your
application stores user/profile data.

### ck-no-iac

A pool configured by hand in the console cannot be reviewed, versioned or
recreated, and drifts silently. Define the pool in code.

### ck-lock-in

Username sign-in, custom attributes and app-specific identity choices make a
future migration away from Cognito significantly harder.
