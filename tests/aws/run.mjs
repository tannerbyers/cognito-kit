/**
 * Layer 5 — real AWS tests (design only).
 *
 * These are intentionally NOT part of normal CI. They require an AWS account
 * and are gated behind COGNITO_KIT_AWS_TESTS=1.
 *
 * Planned (V2):
 *   - deploy a temporary stack with the CDK construct
 *   - exercise real Cognito behavior (sign-up, auth code + PKCE)
 *   - run the same runtime validation contract against real Cognito tokens
 *   - destroy the stack afterwards
 */
const enabled = process.env.COGNITO_KIT_AWS_TESTS === "1"

if (!enabled) {
  console.log("AWS integration tests skipped. Set COGNITO_KIT_AWS_TESTS=1 to enable.")
  process.exit(0)
}

if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
  console.error("COGNITO_KIT_AWS_TESTS=1 requires AWS credentials/region configured.")
  process.exit(1)
}

console.log("Real-AWS integration tests are not implemented yet (planned for V2).")
process.exit(0)
