/**
 * Minimal server-side session helpers.
 *
 * These are intentionally tiny: they store the verified ID token in an
 * httpOnly cookie and recover it from a `Cookie` header. They do not manage
 * sessions, revocation or storage.
 */

export interface SessionCookieOptions {
  name?: string
  path?: string
  maxAgeSeconds?: number
  secure?: boolean
  sameSite?: "Lax" | "Strict" | "None"
}

export interface SessionCookie {
  name: string
  value: string
  httpOnly: true
  secure: boolean
  sameSite: "Lax" | "Strict" | "None"
  path: string
  maxAgeSeconds: number
}

export const DEFAULT_SESSION_COOKIE = "ck_session"

export function createSessionCookie(
  token: string,
  options: SessionCookieOptions = {},
): SessionCookie {
  return {
    name: options.name ?? DEFAULT_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: options.secure ?? false,
    sameSite: options.sameSite ?? "Lax",
    path: options.path ?? "/",
    maxAgeSeconds: options.maxAgeSeconds ?? 60 * 60 * 24 * 7,
  }
}

export function sessionCookieToHeader(cookie: SessionCookie): string {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAgeSeconds}`,
    `SameSite=${cookie.sameSite}`,
  ]
  if (cookie.httpOnly) parts.push("HttpOnly")
  if (cookie.secure) parts.push("Secure")
  return parts.join("; ")
}

/** Parses a raw `Cookie` header and returns the session token, if present. */
export function readSessionCookie(
  cookieHeader: string | undefined,
  options: { name?: string } = {},
): string | undefined {
  if (!cookieHeader) return undefined
  const name = options.name ?? DEFAULT_SESSION_COOKIE
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    if (key === name) return part.slice(idx + 1).trim()
  }
  return undefined
}
