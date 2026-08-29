import { describe, expect, it } from "vitest"
import {
  isLocalhostRedirectUrl,
  isReasonableRedirectUrl,
  isWildcardUrl,
  validateRedirectUrl,
} from "./urls.js"

describe("validateRedirectUrl", () => {
  it("accepts https URLs", () => {
    expect(validateRedirectUrl("https://app.example.com/auth/callback").ok).toBe(true)
  })

  it("accepts http URLs on localhost", () => {
    expect(validateRedirectUrl("http://localhost:3000/auth/callback").ok).toBe(true)
    expect(validateRedirectUrl("http://127.0.0.1:3000/callback").ok).toBe(true)
  })

  it("rejects http URLs on non-localhost origins", () => {
    const v = validateRedirectUrl("http://app.example.com/callback")
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toBe("insecure-origin")
  })

  it("rejects wildcards", () => {
    const v = validateRedirectUrl("https://app.example.com/*")
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toBe("wildcard")
  })

  it("rejects malformed URLs", () => {
    const v = validateRedirectUrl("not a url")
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toBe("not-a-url")
  })

  it("rejects unsupported schemes", () => {
    const v = validateRedirectUrl("ftp://app.example.com/callback")
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toBe("unsupported-scheme")
  })
})

describe("helpers", () => {
  it("detects wildcard URLs", () => {
    expect(isWildcardUrl("https://app.example.com/*")).toBe(true)
    expect(isWildcardUrl("https://app.example.com/callback")).toBe(false)
  })

  it("detects localhost redirect URLs", () => {
    expect(isLocalhostRedirectUrl("http://localhost:3000/callback")).toBe(true)
    expect(isLocalhostRedirectUrl("https://app.example.com/callback")).toBe(false)
  })

  it("isReasonableRedirectUrl agrees with validateRedirectUrl", () => {
    expect(isReasonableRedirectUrl("https://app.example.com/callback")).toBe(true)
    expect(isReasonableRedirectUrl("https://app.example.com/*")).toBe(false)
  })
})
