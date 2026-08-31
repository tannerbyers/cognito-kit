import type { NormalizedPoolConfig } from "./normalize.js"

/**
 * Extensible diagnostic rules.
 *
 * The built-in rules (`DIAGNOSTIC_RULES` from `@cognito-kit/core`) cover the
 * common Cognito traps. If you know another one, add a rule in your own
 * application:
 *
 * ```ts
 * import { DIAGNOSTIC_RULES, defineRule, diagnoseWithRules, warn } from "@cognito-kit/core"
 *
 * const COGNITO017 = defineRule({
 *   id: "COGNITO017",
 *   severity: "warning",
 *   title: "Some weird footgun",
 *   explanation: "Why it matters.",
 *   recommendation: "The exact fix.",
 *   check() {
 *     return [warn(COGNITO017)]
 *   },
 * })
 *
 * const report = diagnoseWithRules(pool, [...DIAGNOSTIC_RULES, COGNITO017])
 * ```
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

export interface DiagnosticRuleCheck {
  (pool: NormalizedPoolConfig): DiagnosticFinding[]
}

export interface DiagnosticRule {
  id: string
  severity: Exclude<FindingStatus, "good">
  title: string
  explanation: string
  recommendation: string
  docsUrl?: string
  check: DiagnosticRuleCheck
}

/**
 * Directive used to return findings from a rule's `check` function without
 * repeating the rule metadata on every return.
 */
export function good(rule: DiagnosticRule, titleOverride?: string): DiagnosticFinding {
  return {
    ruleId: rule.id,
    status: "good",
    title: titleOverride ?? rule.title,
    explanation: rule.explanation,
    recommendation: rule.recommendation,
    docsUrl: rule.docsUrl,
  }
}

export function warn(
  rule: DiagnosticRule,
  detail?: string,
  titleOverride?: string,
): DiagnosticFinding {
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

export function crit(
  rule: DiagnosticRule,
  detail?: string,
  titleOverride?: string,
): DiagnosticFinding {
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

/**
 * Wraps a rule so that `this` inside `check` is the rule itself — this is how
 * the `good(this)` / `warn(this)` / `crit(this)` helpers work with a plain
 * object rule definition.
 */
export function defineRule(rule: DiagnosticRule): DiagnosticRule {
  const wrapped: DiagnosticRule = { ...rule, check: (pool) => rule.check.call(wrapped, pool) }
  return wrapped
}

/**
 * Runs a set of rules against a normalized pool configuration. Pass the
 * built-in rules explicitly (e.g. `DIAGNOSTIC_RULES` from `@cognito-kit/core`)
 * to evaluate custom rules alongside them.
 */
export function diagnoseWithRules(
  pool: NormalizedPoolConfig,
  rules: readonly DiagnosticRule[],
): DiagnosticReport {
  const findings = rules.flatMap((rule) => rule.check(pool))
  const summary = {
    good: findings.filter((f) => f.status === "good").length,
    warning: findings.filter((f) => f.status === "warning").length,
    critical: findings.filter((f) => f.status === "critical").length,
  }
  return { findings, summary }
}