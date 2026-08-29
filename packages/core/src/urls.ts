/**
 * Shared URL validation used by both configuration validation and diagnosis.
 *
 * Kept in `core` so that every layer (CLI, CDK, diagnostics) applies the same
 * rules for callback / logout URLs.
 */

/** Combined value: the raw URL string plus its parsed form. */
export interface ParsedRedirectUrl {
  raw: string
  url: URL
}

export type UrlValidation =
  | { ok: true; url: URL }
  | { ok: false; error: "wildcard" | "not-a-url" | "unsupported-scheme" | "insecure-origin" }

/** Hosts that are allowed to be served over plain HTTP (dev-only). */
export const LOCALHOST_INSECURE_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
])

function normalizeHost(host: string): string {
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  return h.toLowerCase()
}

export function validateRedirectUrl(raw: string): UrlValidation {
  if (raw.includes("*")) {
    return { ok: false, error: "wildcard" }
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: "not-a-url" }
  }
  if (parsed.protocol === "https:") {
    return { ok: true, url: parsed }
  }
  if (parsed.protocol === "http:") {
    if (LOCALHOST_INSECURE_HOSTS.has(normalizeHost(parsed.hostname))) {
      return { ok: true, url: parsed }
    }
    return { ok: false, error: "insecure-origin" }
  }
  return { ok: false, error: "unsupported-scheme" }
}

export function isReasonableRedirectUrl(raw: string): boolean {
  return validateRedirectUrl(raw).ok
}

export function isWildcardUrl(raw: string): boolean {
  return raw.includes("*")
}

export function isLocalhostRedirectUrl(raw: string): boolean {
  const v = validateRedirectUrl(raw)
  if (!v.ok) return false
  const host = normalizeHost(v.url.hostname)
  return LOCALHOST_INSECURE_HOSTS.has(host) || v.url.protocol === "http:"
}
