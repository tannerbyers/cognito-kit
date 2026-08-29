import type { NormalizedPoolConfig } from "./normalize.js"

/**
 * Migration analysis.
 *
 * Pure, offline comparison of two normalized pool configurations. It reports
 * what changes, how impactful each change is, and which changes are risky or
 * impossible to apply to an existing pool. Used by `cognito-kit migrate`.
 */

export type MigrationImpact = "low" | "medium" | "high"

export interface MigrationChange {
  path: string
  kind: "added" | "removed" | "changed"
  from?: unknown
  to?: unknown
  impact: MigrationImpact
}

export interface MigrationRisk {
  path: string
  severity: "warning" | "critical"
  message: string
}

export interface MigrationAnalysis {
  changes: MigrationChange[]
  risks: MigrationRisk[]
  summary: { low: number; medium: number; high: number }
}

const IMPACT: Record<string, MigrationImpact> = {
  "usernameConfiguration.caseSensitive": "high",
  "signIn.email": "high",
  "signIn.username": "high",
  "signIn.phone": "high",
  "requiredAttributes": "high",
  "customAttributes": "high",
  "application.identity": "high",
  "verification.email": "medium",
  "mfaConfiguration": "medium",
  "accountRecovery.methods": "medium",
  "appClient.generateSecret": "medium",
  "appClient.callbackUrls": "medium",
  "appClient.logoutUrls": "medium",
  "appClient.allowedOAuthFlows.authorizationCodeGrant": "medium",
  "appClient.allowedOAuthFlows.implicitFlow": "medium",
  "appClient.allowedOAuthFlows.clientCredentials": "medium",
  "appClient.allowedOAuthFlows.userPassword": "medium",
  "appClient.allowedOAuthScopes": "low",
  "appClient.tokenValidity.idTokenMinutes": "low",
  "appClient.tokenValidity.accessTokenMinutes": "low",
  "appClient.tokenValidity.refreshTokenDays": "low",
  "infrastructure.deletionProtection": "low",
  name: "low",
}

interface Field {
  path: string
  get: (p: NormalizedPoolConfig) => unknown
}

const FIELDS: Field[] = [
  { path: "name", get: (p) => p.name },
  { path: "usernameConfiguration.caseSensitive", get: (p) => p.usernameConfiguration.caseSensitive },
  { path: "signIn.email", get: (p) => p.signIn.email },
  { path: "signIn.username", get: (p) => p.signIn.username },
  { path: "signIn.phone", get: (p) => p.signIn.phone },
  { path: "verification.email", get: (p) => p.verification.email },
  { path: "mfaConfiguration", get: (p) => p.mfaConfiguration },
  { path: "accountRecovery.methods", get: (p) => [...p.accountRecovery.methods].sort() },
  { path: "requiredAttributes", get: (p) => [...p.requiredAttributes].sort() },
  { path: "customAttributes", get: (p) => p.customAttributes.map((a) => a.name).sort() },
  { path: "appClient.generateSecret", get: (p) => p.appClient.generateSecret },
  { path: "appClient.callbackUrls", get: (p) => [...p.appClient.callbackUrls].sort() },
  { path: "appClient.logoutUrls", get: (p) => [...p.appClient.logoutUrls].sort() },
  {
    path: "appClient.allowedOAuthFlows.authorizationCodeGrant",
    get: (p) => p.appClient.allowedOAuthFlows.authorizationCodeGrant,
  },
  { path: "appClient.allowedOAuthFlows.implicitFlow", get: (p) => p.appClient.allowedOAuthFlows.implicitFlow },
  {
    path: "appClient.allowedOAuthFlows.clientCredentials",
    get: (p) => p.appClient.allowedOAuthFlows.clientCredentials,
  },
  { path: "appClient.allowedOAuthFlows.userPassword", get: (p) => p.appClient.allowedOAuthFlows.userPassword },
  { path: "appClient.allowedOAuthScopes", get: (p) => [...p.appClient.allowedOAuthScopes].sort() },
  { path: "appClient.tokenValidity.idTokenMinutes", get: (p) => p.appClient.tokenValidity.idTokenMinutes },
  { path: "appClient.tokenValidity.accessTokenMinutes", get: (p) => p.appClient.tokenValidity.accessTokenMinutes },
  { path: "appClient.tokenValidity.refreshTokenDays", get: (p) => p.appClient.tokenValidity.refreshTokenDays },
  { path: "infrastructure.deletionProtection", get: (p) => p.infrastructure.deletionProtection },
  { path: "application.identity", get: (p) => p.application.identity },
]

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  )
}

/**
 * Compares two normalized pool configurations and produces a migration
 * analysis. Pure and fully offline.
 */
export function analyzeMigration(
  from: NormalizedPoolConfig,
  to: NormalizedPoolConfig,
): MigrationAnalysis {
  const changes: MigrationChange[] = []

  for (const field of FIELDS) {
    const fromVal = field.get(from)
    const toVal = field.get(to)
    if (eq(fromVal, toVal)) continue
    const kind: MigrationChange["kind"] = isEmpty(fromVal)
      ? "added"
      : isEmpty(toVal)
        ? "removed"
        : "changed"
    changes.push({
      path: field.path,
      kind,
      from: fromVal,
      to: toVal,
      impact: IMPACT[field.path] ?? "medium",
    })
  }

  const risks: MigrationRisk[] = []

  const removedRequired = (from.requiredAttributes ?? []).filter(
    (a) => !(to.requiredAttributes ?? []).includes(a),
  )
  if (removedRequired.length > 0) {
    risks.push({
      path: "requiredAttributes",
      severity: "critical",
      message: `required attributes cannot be removed from an existing pool: ${removedRequired.join(", ")}`,
    })
  }

  const removedCustom = (from.customAttributes ?? []).filter(
    (a) => !(to.customAttributes ?? []).some((b) => b.name === a.name),
  )
  if (removedCustom.length > 0) {
    risks.push({
      path: "customAttributes",
      severity: "critical",
      message: `custom attributes cannot be removed from an existing pool: ${removedCustom.map((a) => a.name).join(", ")}`,
    })
  }

  if (from.signIn.email !== to.signIn.email || from.signIn.username !== to.signIn.username) {
    risks.push({
      path: "signIn",
      severity: "critical",
      message: "sign-in mode cannot be changed in place; requires a new pool and user migration",
    })
  }

  if (from.usernameConfiguration.caseSensitive !== to.usernameConfiguration.caseSensitive) {
    risks.push({
      path: "usernameConfiguration.caseSensitive",
      severity: "critical",
      message: "case sensitivity cannot be changed in place",
    })
  }

  if (from.application.identity !== to.application.identity) {
    risks.push({
      path: "application.identity",
      severity: "warning",
      message: "changing the application identity requires re-keying user data",
    })
  }

  if (from.appClient.generateSecret !== to.appClient.generateSecret) {
    risks.push({
      path: "appClient.generateSecret",
      severity: "warning",
      message: "client secret changes require updating application configuration",
    })
  }

  if (!eq(from.appClient.callbackUrls, to.appClient.callbackUrls)) {
    risks.push({
      path: "appClient.callbackUrls",
      severity: "warning",
      message: "update the application's registered redirect URIs",
    })
  }

  const summary = { low: 0, medium: 0, high: 0 }
  for (const change of changes) summary[change.impact]++

  return { changes, risks, summary }
}