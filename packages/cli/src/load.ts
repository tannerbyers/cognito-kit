import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createJiti } from "jiti"
import type { AuthConfig } from "@cognito-kit/core"
import { normalizeConfig, parseNormalizedPoolConfig } from "@cognito-kit/core"
import type { NormalizedPoolConfig } from "@cognito-kit/core"

const jiti = createJiti(import.meta.url)

/**
 * Loads a developer-facing auth config (`.ts` or `.json`).
 * `.ts` files are evaluated with jiti so `defineAuth(...)` works.
 */
export function loadAuthConfig(path: string): AuthConfig {
  const resolved = resolve(path)
  const loaded = jiti(resolved) as unknown
  // jiti may return the module namespace ({ default: ... }) or the default
  // export directly, depending on the module format.
  const raw =
    loaded && typeof loaded === "object" && "default" in loaded
      ? (loaded as { default: unknown }).default
      : loaded
  if (typeof raw !== "object" || raw === null || !("signIn" in raw)) {
    throw new Error(`config at ${path} does not look like an auth config (missing signIn)`)
  }
  return raw as AuthConfig
}

/** Loads a normalized pool document (JSON). */
export function loadNormalizedPool(path: string): NormalizedPoolConfig {
  const resolved = resolve(path)
  const raw = JSON.parse(readFileSync(resolved, "utf8")) as unknown
  return parseNormalizedPoolConfig(raw)
}

/** Loads a users file (`.json` or `.ts`) for `cognito-kit dev`. */
export function loadUsersFile(path: string): Array<{
  id: string
  email: string
  password: string
  claims?: Record<string, unknown>
}> {
  const resolved = resolve(path)
  const raw = jiti(resolved) as unknown
  if (!Array.isArray(raw)) {
    throw new Error(`users file at ${path} must export an array of users`)
  }
  for (const user of raw) {
    if (typeof user !== "object" || user === null || !("email" in user) || !("password" in user)) {
      throw new Error(`users file at ${path} contains an invalid user entry`)
    }
  }
  return raw as Array<{
    id: string
    email: string
    password: string
    claims?: Record<string, unknown>
  }>
}

/**
 * Loads a "pool-like" source: either a normalized pool document (JSON) or a
 * developer-facing auth config (`.json` or `.ts`). Used by `migrate`.
 */
export function loadPoolLike(path: string): NormalizedPoolConfig {
  const resolved = resolve(path)
  if (resolved.endsWith(".json")) {
    const raw = JSON.parse(readFileSync(resolved, "utf8")) as Record<string, unknown>
    if (raw.formatVersion === 1 && raw.provider === "cognito") {
      return parseNormalizedPoolConfig(raw)
    }
    if ("signIn" in raw && "application" in raw) {
      return normalizeConfig(raw as unknown as AuthConfig)
    }
    throw new Error(
      `file at ${path} is neither a normalized pool document nor an auth config`,
    )
  }
  return normalizeConfig(loadAuthConfig(resolved))
}
