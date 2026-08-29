import { defineConfig } from "vitest/config"

const alias = {
  "@cognito-kit/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
  "@cognito-kit/runtime": new URL("./packages/runtime/src/index.ts", import.meta.url).pathname,
  "@cognito-kit/local-auth": new URL("./packages/local-auth/src/index.ts", import.meta.url).pathname,
  "@cognito-kit/testing": new URL("./packages/testing/src/index.ts", import.meta.url).pathname,
  "@cognito-kit/infrastructure": new URL("./packages/infrastructure/src/index.ts", import.meta.url).pathname,
}

/**
 * Test layers (all fully offline, no AWS required):
 *
 *  - unit        : fast isolated unit tests colocated with package sources
 *  - contract    : tests/contract — normalized auth contract across providers
 *  - infra       : tests/infra — CDK synthesis + CloudFormation snapshots
 *  - integration : tests/integration — real local OIDC server flows
 *
 * `pnpm test` runs all projects; `pnpm test:<layer>` runs one.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts"],
        },
        resolve: { alias },
      },
      {
        test: {
          name: "contract",
          include: ["tests/contract/**/*.test.ts"],
        },
        resolve: { alias },
      },
      {
        test: {
          name: "infra",
          include: ["tests/infra/**/*.test.ts"],
        },
        resolve: { alias },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
        },
        resolve: { alias },
      },
    ],
  },
})