import type { NormalizedPoolConfig } from "./normalize.js"
import { normalizeConfig } from "./normalize.js"
import { isWildcardUrl, validateRedirectUrl } from "./urls.js"

/**
 * The diagnostics engine.
 *
 * Pure functions over a normalized plain-object pool configuration. It has no
 * knowledge of AWS, the network, or the CLI — which is exactly why it can be
 * exhaustively unit tested offline and reused by the `doctor` command for both
 * local fixtures and (in the future) real AWS state.
 */

export type FindingStatus = "good" | "warning" | "critical"

export interface DiagnosticFinding {
  ruleId: string
  status: FindingStatus
  title: string
  explanation: string
  recommendation: string
  docsUrl?: string
  /** Optional machine-usable detail (e.g. the offending URL). */
  detail?: string
}

export interface DiagnosticReport {
  findings: DiagnosticFinding[]
  summary: { good: number; warning: number; critical: number }
}

export interface DiagnosticRule {
  id: string
  severity: Exclude<FindingStatus, "good">
  title: string
  explanation: string
  recommendation: string
  docsUrl?: string
  check: (pool: NormalizedPoolConfig) => DiagnosticFinding[]
}

const DOCS_BASE = "https://github.com/cognito-kit/cognito-kit/blob/main/docs/generated"

function good(rule: DiagnosticRule, titleOverride?: string): DiagnosticFinding {
  return {
    ruleId: rule.id,
    status: "good",
    title: titleOverride ?? rule.title,
    explanation: rule.explanation,
    recommendation: rule.recommendation,
    docsUrl: rule.docsUrl,
  }
}

function warn(rule: DiagnosticRule, detail?: string, titleOverride?: string): DiagnosticFinding {
  return {
    ruleId: rule.id,
    status: "warning",
    title: titleOverride ?? rule.title,
    explanation: rule.explanation,
    recommendation: rule.recommendation,
    docsUrl: rule.docsUrl,
    detail,
  }
}

function crit(rule: DiagnosticRule, detail?: string, titleOverride?: string): DiagnosticFinding {
  return {
    ruleId: rule.id,
    status: "critical",
    title: titleOverride ?? rule.title,
    explanation: rule.explanation,
    recommendation: rule.recommendation,
    docsUrl: rule.docsUrl,
    detail,
  }
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

const emailCaseSensitive: DiagnosticRule = {
  id: "ck-email-case-sensitive",
  severity: "critical",
  title: "Email usernames are case sensitive",
  explanation:
    "Case-sensitive email identities let the same person create multiple, logically equivalent accounts (Alice@example.com vs alice@example.com).",
  recommendation:
    "Use email aliases with case-insensitive matching (UsernameConfiguration.CaseSensitive = false) so identities are normalized.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-email-case-sensitive`,
  check(pool) {
    if (!pool.signIn.email) return [good(this)]
    if (pool.usernameConfiguration.caseSensitive) {
      return [crit(this, "usernameConfiguration.caseSensitive = true")]
    }
    return [good(this, "Case-insensitive email identities")]
  },
}

const emailAsIdentity: DiagnosticRule = {
  id: "ck-email-as-identity",
  severity: "warning",
  title: "Application uses email as immutable database ID",
  explanation:
    "Email addresses change and can be recycled. Using email as the canonical application identity couples your database to a mutable value.",
  recommendation:
    "Use the Cognito `sub` claim as the canonical, immutable identity and treat email as a mutable contact attribute.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-email-as-identity`,
  check(pool) {
    if (pool.application.identity === "email") {
      return [warn(this)]
    }
    return [good(this, "Email not used as application identity")]
  },
}

const subIdentity: DiagnosticRule = {
  id: "ck-sub-identity",
  severity: "warning",
  title: "Cognito `sub` used as canonical identity",
  explanation:
    "The `sub` claim is stable, opaque and globally unique — the correct canonical identity for an end user.",
  recommendation:
    "Keep using `sub` as the primary key for user data; treat `email` and `username` as lookups, not keys.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-sub-identity`,
  check(pool) {
    if (pool.application.identity === "cognito_sub") {
      return [good(this, "Cognito `sub` used as canonical identity")]
    }
    return [warn(this, undefined, "Cognito `sub` not used as canonical identity")]
  },
}

const customAttributes: DiagnosticRule = {
  id: "ck-custom-attributes",
  severity: "warning",
  title: "Custom attributes detected",
  explanation:
    "Custom Cognito attributes cannot easily be removed later, are awkward to query, and encourage storing application data in the identity provider.",
  recommendation:
    "Store roles, preferences, subscriptions and other profile data in your own database, keyed by `sub`.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-custom-attributes`,
  check(pool) {
    if (pool.customAttributes.length > 0) {
      return [
        warn(
          this,
          `${pool.customAttributes.length} custom attribute(s): ${pool.customAttributes
            .map((a) => a.name)
            .join(", ")}`,
        ),
      ]
    }
    return [good(this, "No custom attributes")]
  },
}

const requiredAttributes: DiagnosticRule = {
  id: "ck-required-attributes",
  severity: "warning",
  title: "Unnecessary required attributes",
  explanation:
    "Every required attribute is a blocker for sign-up and a migration liability. Require only what identity verification needs.",
  recommendation:
    "Require only the sign-in identifier (e.g. email). Collect everything else in your application.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-required-attributes`,
  check(pool) {
    const essentials = new Set<string>()
    if (pool.signIn.email) essentials.add("email")
    if (pool.signIn.username) essentials.add("username")
    const extra = pool.requiredAttributes.filter((a) => !essentials.has(a))
    if (extra.length > 0) {
      return [warn(this, `extra required attributes: ${extra.join(", ")}`)]
    }
    return [good(this, "No unnecessary required attributes")]
  },
}

const implicitFlow: DiagnosticRule = {
  id: "ck-implicit-flow",
  severity: "critical",
  title: "Implicit OAuth flow is enabled",
  explanation:
    "The implicit flow returns tokens in the URL fragment, leaking them into browser history, referrer headers and logs.",
  recommendation:
    "Use the authorization code flow with PKCE. Disable the implicit flow on the app client.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-implicit-flow`,
  check(pool) {
    if (pool.appClient.allowedOAuthFlows.implicitFlow) {
      return [crit(this)]
    }
    return [good(this, "Implicit OAuth flow disabled")]
  },
}

const passwordFlow: DiagnosticRule = {
  id: "ck-password-flow",
  severity: "warning",
  title: "Resource-owner password flow is enabled",
  explanation:
    "USER_PASSWORD_AUTH hands the password to the application and bypasses the hosted UI, MFA and WebAuthn.",
  recommendation:
    "Disable USER_PASSWORD_AUTH and client-credentials grants unless you have a specific, documented need.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-password-flow`,
  check(pool) {
    if (
      pool.appClient.allowedOAuthFlows.userPassword ||
      pool.appClient.allowedOAuthFlows.clientCredentials
    ) {
      return [warn(this)]
    }
    return [good(this, "No unnecessary password/client-credentials flows")]
  },
}

const emailVerification: DiagnosticRule = {
  id: "ck-email-verification",
  severity: "critical",
  title: "Email verification is not enforced",
  explanation:
    "Unverified email addresses can be claimed by the wrong person, enabling account takeover and spam sign-ups.",
  recommendation:
    "Require email verification before sign-in completes (autoVerify email + email as required attribute).",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-email-verification`,
  check(pool) {
    if (!pool.signIn.email) return [good(this)]
    if (pool.verification.email === "disabled") return [crit(this)]
    if (pool.verification.email === "optional") return [warn(this)]
    return [good(this, "Email verification enforced")]
  },
}

const callbackUrls: DiagnosticRule = {
  id: "ck-callback-urls",
  severity: "critical",
  title: "Unsafe callback or logout URLs",
  explanation:
    "Invalid callback URLs (non-URLs, plain-HTTP on non-localhost, or non-https schemes) are either broken or allow token leakage.",
  recommendation:
    "Use exact, https:// callback URLs in production and http://localhost only in development.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-callback-urls`,
  check(pool) {
    const urls = [
      ...pool.appClient.callbackUrls.map((u) => ({ kind: "callback", url: u })),
      ...pool.appClient.logoutUrls.map((u) => ({ kind: "logout", url: u })),
    ]
    const findings: DiagnosticFinding[] = []
    let allGood = true
    for (const { kind, url } of urls) {
      const v = validateRedirectUrl(url)
      if (!v.ok) {
        allGood = false
        findings.push(crit(this, `${kind} URL ${JSON.stringify(url)} is invalid: ${v.error}`))
      }
    }
    if (allGood) findings.push(good(this, "Callback and logout URLs valid"))
    return findings
  },
}

const wildcardCallback: DiagnosticRule = {
  id: "ck-wildcard-callback",
  severity: "critical",
  title: "Wildcard callback URL",
  explanation:
    "Cognito requires exact callback URL matches; wildcards are not supported and indicate a misunderstanding that typically breaks login.",
  recommendation: "List every exact redirect URI. If you need many, register them explicitly.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-wildcard-callback`,
  check(pool) {
    const urls = [
      ...pool.appClient.callbackUrls.map((u) => ({ kind: "callback", url: u })),
      ...pool.appClient.logoutUrls.map((u) => ({ kind: "logout", url: u })),
    ]
    const wild = urls.filter(({ url }) => isWildcardUrl(url))
    const findings: DiagnosticFinding[] = []
    if (wild.length > 0) {
      findings.push(crit(this, `wildcard URL(s): ${wild.map((w) => w.url).join(", ")}`))
    } else {
      findings.push(good(this, "No wildcard callback URLs"))
    }
    return findings
  },
}

const tokenDuration: DiagnosticRule = {
  id: "ck-token-duration",
  severity: "warning",
  title: "Excessively long token lifetime",
  explanation: "Long-lived tokens amplify the blast radius of a leaked token and delay revocation.",
  recommendation:
    "Keep ID/access tokens at 60 minutes or less and use refresh tokens for longer sessions.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-token-duration`,
  check(pool) {
    const { idTokenMinutes, accessTokenMinutes } = pool.appClient.tokenValidity
    if (idTokenMinutes > 60 || accessTokenMinutes > 60) {
      return [warn(this, `idToken=${idTokenMinutes}min, accessToken=${accessTokenMinutes}min`)]
    }
    return [good(this, "Token lifetimes within safe bounds")]
  },
}

const accountRecovery: DiagnosticRule = {
  id: "ck-account-recovery",
  severity: "warning",
  title: "Account recovery is not configured",
  explanation:
    "Without recovery, users who lose their password are locked out and support burden grows.",
  recommendation:
    "Enable email-based account recovery (AccountRecoverySetting EMAIL_ONLY) rather than admin-only recovery.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-account-recovery`,
  check(pool) {
    if (!pool.accountRecovery.enabled || pool.accountRecovery.methods.length === 0) {
      return [warn(this)]
    }
    if (pool.accountRecovery.methods.every((m) => m === "admin_only")) {
      return [warn(this, "recovery is admin-only")]
    }
    return [good(this, "Account recovery configured")]
  },
}

const clientVisibility: DiagnosticRule = {
  id: "ck-client-visibility",
  severity: "warning",
  title: "Incorrect public/confidential client configuration",
  explanation:
    "A confidential (web) client without a secret, or a public (SPA/mobile) client with a secret, signals a misunderstanding of the OAuth client model.",
  recommendation:
    "Web apps: generate a client secret. SPAs and native apps: no secret, rely on PKCE.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-client-visibility`,
  check(pool) {
    // The normalized model does not carry the app type; infer from the secret.
    // `generateSecret` is the observable behavior we care about.
    if (!pool.appClient.generateSecret) {
      return [
        warn(
          this,
          "app client has no client secret — appropriate for SPA/mobile, risky for a confidential web app",
        ),
      ]
    }
    return [good(this, "Client visibility configuration is sound")]
  },
}

const profileStorage: DiagnosticRule = {
  id: "ck-profile-storage",
  severity: "warning",
  title: "Excessive Cognito profile storage",
  explanation:
    "Storing application profile data (roles, preferences, subscriptions) in Cognito attributes couples identity to business state and makes migration painful.",
  recommendation:
    "Cognito stores identity; your application stores user/profile data. Keep attributes minimal.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-profile-storage`,
  check(pool) {
    const stored = pool.customAttributes.length + pool.requiredAttributes.length
    if (pool.application.storesProfileDataInCognito || stored > 6) {
      return [
        warn(
          this,
          `~${stored} attributes stored in Cognito${pool.application.storesProfileDataInCognito ? " and app profile data lives in Cognito" : ""}`,
        ),
      ]
    }
    return [good(this, "No excessive Cognito profile storage")]
  },
}

const noIac: DiagnosticRule = {
  id: "ck-no-iac",
  severity: "warning",
  title: "Infrastructure is not reproducible",
  explanation:
    "A pool configured by hand in the console cannot be reviewed, versioned or recreated, and drifts silently.",
  recommendation:
    "Define the pool in code (cognito-kit CDK construct, CloudFormation or Terraform) and deploy from that definition.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-no-iac`,
  check(pool) {
    if (!pool.infrastructure.reproducible) return [warn(this)]
    if (
      pool.infrastructure.provisionedBy === "console" ||
      pool.infrastructure.provisionedBy === "unknown"
    ) {
      return [warn(this, `provisioned by ${pool.infrastructure.provisionedBy}`)]
    }
    return [good(this, "Infrastructure is reproducible")]
  },
}

const lockIn: DiagnosticRule = {
  id: "ck-lock-in",
  severity: "warning",
  title: "Configuration increases Cognito lock-in",
  explanation:
    "Username sign-in, custom attributes and app-specific identity choices make a future migration away from Cognito (or between pools) significantly harder.",
  recommendation:
    "Prefer email sign-in, no custom attributes, and `sub`-keyed application data to keep a clean migration path.",
  docsUrl: `${DOCS_BASE}/diagnostics.md#ck-lock-in`,
  check(pool) {
    const risks: string[] = []
    if (pool.signIn.username) risks.push("username sign-in")
    if (pool.customAttributes.length > 0) risks.push("custom attributes")
    if (pool.application.identity === "cognito_username") risks.push("username as app identity")
    if (risks.length > 0) {
      return [warn(this, risks.join(", "))]
    }
    return [good(this, "No Cognito lock-in risks detected")]
  },
}

/** Every diagnostic rule, in display order. */
export const DIAGNOSTIC_RULES: readonly DiagnosticRule[] = [
  emailCaseSensitive,
  subIdentity,
  emailAsIdentity,
  emailVerification,
  customAttributes,
  requiredAttributes,
  implicitFlow,
  passwordFlow,
  callbackUrls,
  wildcardCallback,
  tokenDuration,
  accountRecovery,
  clientVisibility,
  profileStorage,
  noIac,
  lockIn,
]

/** Runs every rule against a normalized pool configuration. */
export function diagnoseUserPool(pool: NormalizedPoolConfig): DiagnosticReport {
  const findings = DIAGNOSTIC_RULES.flatMap((rule) => rule.check(pool))
  const summary = {
    good: findings.filter((f) => f.status === "good").length,
    warning: findings.filter((f) => f.status === "warning").length,
    critical: findings.filter((f) => f.status === "critical").length,
  }
  return { findings, summary }
}

/** Convenience: diagnose a developer-facing config after normalizing it. */
export function diagnoseAuthConfig(
  config: Parameters<typeof normalizeConfig>[0],
): DiagnosticReport {
  return diagnoseUserPool(normalizeConfig(config))
}
