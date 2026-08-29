/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Linting happens at the monorepo root; skip Next's built-in lint pass.
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
