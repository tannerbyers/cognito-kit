import { describe, expect, it } from "vitest"
import { generateCodeChallenge, generateCodeVerifier, verifyPkce } from "./pkce.js"
import { findUserByEmail, verifyPassword } from "./users.js"
import { defaultUsers } from "./users.js"

describe("PKCE", () => {
  it("verifies a correct S256 challenge", () => {
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)
    expect(verifyPkce(challenge, "S256", verifier)).toBe(true)
  })

  it("rejects a wrong verifier", () => {
    const challenge = generateCodeChallenge("verifier-a")
    expect(verifyPkce(challenge, "S256", "verifier-b")).toBe(false)
  })

  it("rejects a missing verifier when a challenge was sent", () => {
    const challenge = generateCodeChallenge("verifier-a")
    expect(verifyPkce(challenge, "S256", undefined)).toBe(false)
  })

  it("rejects unsupported challenge methods", () => {
    const challenge = generateCodeChallenge("verifier-a")
    expect(verifyPkce(challenge, "plain", "verifier-a")).toBe(false)
  })

  it("allows requests without PKCE when no challenge was sent", () => {
    expect(verifyPkce(null, null, undefined)).toBe(true)
  })
})

describe("users", () => {
  it("provides default development users", () => {
    const users = defaultUsers()
    expect(users.map((u) => u.email)).toEqual(["alice@example.com", "admin@example.com"])
  })

  it("finds users by email case-insensitively", () => {
    const user = findUserByEmail(defaultUsers(), "ALICE@example.com")
    expect(user?.id).toBe("dev_alice")
  })

  it("verifies passwords", () => {
    const [alice] = defaultUsers()
    expect(verifyPassword(alice, "password")).toBe(true)
    expect(verifyPassword(alice, "wrong")).toBe(false)
  })
})
