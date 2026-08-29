import type { LocalUser } from "./types.js"

export function defaultUsers(): LocalUser[] {
  return [
    {
      id: "dev_alice",
      email: "alice@example.com",
      password: "password",
      claims: {},
    },
    {
      id: "dev_admin",
      email: "admin@example.com",
      password: "password",
      claims: {
        role: "admin",
      },
    },
  ]
}

export function stripPasswords(users: LocalUser[]): Array<Omit<LocalUser, "password">> {
  return users.map(({ id, email, claims, emailVerified }) => ({
    id,
    email,
    claims,
    emailVerified,
  }))
}

export function findUserByEmail(users: LocalUser[], email: string): LocalUser | undefined {
  const normalized = email.trim().toLowerCase()
  return users.find((u) => u.email.toLowerCase() === normalized)
}

export function verifyPassword(user: LocalUser, password: string): boolean {
  return user.password === password
}
