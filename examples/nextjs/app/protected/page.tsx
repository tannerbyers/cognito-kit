import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"

export default async function ProtectedPage() {
  const store = await cookies()
  const user = await verifySessionToken(store.get(SESSION_COOKIE)?.value)

  if (!user) {
    redirect("/auth/signin")
  }

  return (
    <main>
      <h1>Protected page</h1>
      <p>You can see this because your session token was verified server-side.</p>
      <pre style={{ background: "#fff", padding: "1rem", borderRadius: 8 }}>
        {JSON.stringify(user, null, 2)}
      </pre>
      <p>
        <Link href="/">Home</Link> · <Link href="/auth/signout">Sign out</Link>
      </p>
    </main>
  )
}
