import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "cognito-kit Next.js example",
  description: "Authenticate with the same contract locally and in production.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f6f7f9" }}>
        <div style={{ maxWidth: 640, margin: "3rem auto", padding: "0 1rem" }}>{children}</div>
      </body>
    </html>
  )
}
