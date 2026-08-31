import type { AuthConfig } from "./config.js"
import { CURRENT_SCHEMA_VERSION } from "./config.js"
import { isWildcardUrl, validateRedirectUrl } from "./urls.js"

export type ConfigIssueSeverity = "error" | "warning"

export interface ConfigIssue {
  path: string
  severity: ConfigIssueSeverity
  message: string
}

/**
 * Validates a developer-facing {@link AuthConfig} and returns a list of
 * issues. Never throws. Errors prevent safe use; warnings are tolerated but
 * discouraged.
 */
export function validateAuthConfig(config: AuthConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = []

  if (config.schemaVersion !== undefined && config.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      severity: "error",
      message: `unsupported schemaVersion ${config.schemaVersion}; this version of cognito-kit supports ${CURRENT_SCHEMA_VERSION}`,
    })
  }

  if (config.signIn !== "email" && config.signIn !== "username") {
    issues.push({
      path: "signIn",
      severity: "error",
      message: `signIn must be "email" or "username", got ${JSON.stringify(config.signIn)}`,
    })
  }

  if (!config.application || typeof config.application !== "object") {
    issues.push({
      path: "application",
      severity: "error",
      message: "application is required",
    })
    return issues
  }

  const app = config.application

  if (!["web", "spa", "mobile"].includes(app.type)) {
    issues.push({
      path: "application.type",
      severity: "error",
      message: `application.type must be "web", "spa" or "mobile", got ${JSON.stringify(app.type)}`,
    })
  }

  if (!Array.isArray(app.callbackUrls) || app.callbackUrls.length === 0) {
    issues.push({
      path: "application.callbackUrls",
      severity: "error",
      message: "at least one callback URL is required",
    })
  } else {
    app.callbackUrls.forEach((url, i) => {
      const v = validateRedirectUrl(url)
      if (!v.ok) {
        issues.push({
          path: `application.callbackUrls[${i}]`,
          severity: "error",
          message: `callback URL ${JSON.stringify(url)} is invalid: ${v.error}`,
        })
      }
      if (isWildcardUrl(url)) {
        issues.push({
          path: `application.callbackUrls[${i}]`,
          severity: "error",
          message: `callback URL ${JSON.stringify(url)} contains a wildcard; Cognito requires exact matches`,
        })
      }
    })
  }

  if (!Array.isArray(app.logoutUrls) || app.logoutUrls.length === 0) {
    issues.push({
      path: "application.logoutUrls",
      severity: "error",
      message: "at least one logout URL is required",
    })
  } else {
    app.logoutUrls.forEach((url, i) => {
      const v = validateRedirectUrl(url)
      if (!v.ok) {
        issues.push({
          path: `application.logoutUrls[${i}]`,
          severity: "error",
          message: `logout URL ${JSON.stringify(url)} is invalid: ${v.error}`,
        })
      }
    })
  }

  if (app.scopes && !app.scopes.includes("openid")) {
    issues.push({
      path: "application.scopes",
      severity: "error",
      message: 'scopes must include "openid" for OpenID Connect',
    })
  }

  const token = config.token ?? {}
  if (
    token.idTokenMinutes !== undefined &&
    (token.idTokenMinutes < 1 || token.idTokenMinutes > 60)
  ) {
    issues.push({
      path: "token.idTokenMinutes",
      severity: "warning",
      message: "idTokenMinutes outside 1..60; Cognito caps ID tokens at 60 minutes",
    })
  }
  if (
    token.accessTokenMinutes !== undefined &&
    (token.accessTokenMinutes < 1 || token.accessTokenMinutes > 1440)
  ) {
    issues.push({
      path: "token.accessTokenMinutes",
      severity: "warning",
      message: "accessTokenMinutes outside 1..1440",
    })
  }
  if (
    token.refreshTokenDays !== undefined &&
    (token.refreshTokenDays < 1 || token.refreshTokenDays > 3650)
  ) {
    issues.push({
      path: "token.refreshTokenDays",
      severity: "warning",
      message: "refreshTokenDays outside 1..3650",
    })
  }

  return issues
}

export function hasConfigErrors(config: AuthConfig): boolean {
  return validateAuthConfig(config).some((i) => i.severity === "error")
}

export function assertValidAuthConfig(config: AuthConfig): void {
  const errors = validateAuthConfig(config).filter((i) => i.severity === "error")
  if (errors.length > 0) {
    const detail = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n")
    throw new Error(`Invalid auth configuration:\n${detail}`)
  }
}
