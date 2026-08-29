import Link from "next/link"
import { cookies } from "next/headers"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"

export default async function Home() {
  const store = await cookies()
  const user = await verifySessionToken(store.get(SESSION_COOKIE)?.value)

  return (
    <main>
      <h1>cognito-kit Next.js example</h1>
      <p>Authenticating against the local OIDC server — the same contract as Cognito.</p>

      {user ? (
        <>
          <p>
            Signed in as <strong>{user.email}</strong> (id: <code>{user.id}</code>)
          </p>
          <ul>
            <li>
              <Link href="/protected">Protected page</Link>
            </li>
            <li>
              <Link href="/api/me">/api/me</Link>
            </li>
            <li>
              <Link href="/auth/signout">Sign out</Link>
            </li>
          </ul>
        </>
      ) : (
        <p>
          <Link href="/auth/signin">Sign in</Link>
        </p>
      )}
    </main>
  )
}
