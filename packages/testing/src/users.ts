import type { LocalUser } from "@cognito-kit/local-auth"

export interface TestUserOverrides {
  id?: string
  email?: string
  password?: string
  claims?: Record<string, unknown>
  emailVerified?: boolean
}

/**
 * Creates a development user for local-auth.
 *
 * ```ts
 * const user = createTestUser({ email: "ada@example.com" })
 * ```
 */
export function createTestUser(overrides: TestUserOverrides = {}): LocalUser {
  return {
    id: overrides.id ?? "test-user",
    email: overrides.email ?? "test@example.com",
    password: overrides.password ?? "password",
    claims: overrides.claims ?? {},
    emailVerified: overrides.emailVerified ?? true,
  }
}
