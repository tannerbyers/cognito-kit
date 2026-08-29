import { analyzeMigration } from "@cognito-kit/core"
import type { MigrationAnalysis, MigrationChange, MigrationRisk } from "@cognito-kit/core"
import { loadPoolLike } from "../load.js"

export interface MigrateOptions {
  from: string
  to: string
}

/**
 * Analyzes a migration between two Cognito configurations (normalized pool
 * documents or auth configs). Fully offline.
 */
export async function migrateCommand(options: MigrateOptions): Promise<MigrationAnalysis> {
  const from = loadPoolLike(options.from)
  const to = loadPoolLike(options.to)
  const analysis = analyzeMigration(from, to)

  console.log(formatMigration(analysis))
  if (analysis.risks.some((r) => r.severity === "critical")) {
    process.exitCode = 1
  }
  return analysis
}

/** Renders a migration analysis as human-readable text. Pure and testable. */
export function formatMigration(analysis: MigrationAnalysis): string {
  const lines: string[] = []
  lines.push("Migration analysis")
  lines.push("")

  if (analysis.changes.length === 0) {
    lines.push("No configuration differences detected.")
  } else {
    lines.push("Changes:")
    for (const change of analysis.changes) {
      lines.push(formatChange(change))
    }
  }

  if (analysis.risks.length > 0) {
    lines.push("")
    lines.push("Risks:")
    for (const risk of analysis.risks) {
      lines.push(formatRisk(risk))
    }
  }

  lines.push("")
  lines.push(
    `Summary: ${analysis.summary.low} low, ${analysis.summary.medium} medium, ${analysis.summary.high} high impact changes`,
  )
  return lines.join("\n")
}

function formatChange(change: MigrationChange): string {
  const icon = change.impact === "high" ? "✗" : change.impact === "medium" ? "⚠" : "·"
  const arrow = change.kind === "added" ? "(added)" : change.kind === "removed" ? "(removed)" : "→"
  return `${icon} [${change.impact}] ${change.path}: ${fmt(change.from)} ${arrow} ${fmt(change.to)}`
}

function formatRisk(risk: MigrationRisk): string {
  const icon = risk.severity === "critical" ? "✗" : "⚠"
  return `${icon} ${risk.message}`
}

function fmt(value: unknown): string {
  if (value === undefined) return "(none)"
  if (Array.isArray(value)) return `[${value.join(", ")}]`
  return String(value)
}