/**
 * Layer 5 — real AWS tests.
 *
 * Deploys a temporary stack with the cognito-kit CDK construct, exercises
 * actual Cognito behavior (admin user creation, real token issuance), runs the
 * same runtime validation contract used locally, then destroys the stack.
 *
 * Gated behind COGNITO_KIT_AWS_TESTS=1. Requires AWS credentials and prior
 * `cdk bootstrap` in the target account/region.
 *
 * Run: pnpm test:aws
 */
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const enabled = process.env.COGNITO_KIT_AWS_TESTS === "1"

if (!enabled) {
  console.log("AWS integration tests skipped. Set COGNITO_KIT_AWS_TESTS=1 to enable.")
  process.exit(0)
}

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION
if (!region) {
  console.error("COGNITO_KIT_AWS_TESTS=1 requires AWS_REGION or AWS_DEFAULT_REGION.")
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const stackName = `CognitoKitAwsTest${suffix}`
const outputsFile = join(tmpdir(), `ck-aws-outputs-${suffix}.json`)

let failures = 0
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function run(cmd) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { stdio: "inherit", cwd: root })
}

async function deploy() {
  run(`npx aws-cdk bootstrap aws://${process.env.AWS_ACCOUNT_ID ?? "unknown"}/${region} --region ${region}`)
  run(
    `npx aws-cdk deploy ${stackName} --app "node tests/aws/app.mjs" --require-approval never --outputs-file ${outputsFile} --region ${region}`,
  )
  return JSON.parse(readFileSync(outputsFile, "utf8"))[stackName]
}

async function destroy() {
  run(`npx aws-cdk destroy ${stackName} --app "node tests/aws/app.mjs" --force --region ${region}`)
}

async function testRealCognito(outputs) {
  const { UserPoolId, UserPoolClientId, Issuer } = outputs
  const email = `ck-test-${suffix}@example.com`
  const password = "Ck-Test-12345!"

  console.log("\n1) Create a real Cognito user (admin API)")
  const sdk = await import("@cognito-kit/aws/sdk")
  const client = new sdk.CognitoIdentityProviderClient({ region })

  await client.send(
    new sdk.AdminCreateUserCommand({
      UserPoolId,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
      ],
      MessageAction: "SUPPRESS",
    }),
  )
  await client.send(
    new sdk.AdminSetUserPasswordCommand({
      UserPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  )
  check("user created", true)

  console.log("\n2) Authenticate and obtain real Cognito tokens")
  const auth = await client.send(
    new sdk.AdminInitiateAuthCommand({
      UserPoolId,
      ClientId: UserPoolClientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  )
  const idToken = auth.AuthenticationResult?.IdToken
  check("id token issued", Boolean(idToken))

  console.log("\n3) Verify with the runtime contract (same as local-auth)")
  const { createRemoteTokenVerifier, normalizeUser } = await import("@cognito-kit/runtime")
  const verifier = createRemoteTokenVerifier({
    issuer: Issuer,
    jwksUrl: `${Issuer}/.well-known/jwks.json`,
    audience: UserPoolClientId,
  })
  const { payload } = await verifier.verify(idToken)
  const user = normalizeUser(payload)
  check("issuer matches the pool", payload.iss === Issuer, String(payload.iss))
  check("sub present", Boolean(user.id))
  check("email claim matches", user.email === email, String(user.email))
  check("email verified", user.emailVerified === true, String(user.emailVerified))
  check("normalized user shape", user.id && user.email && user.claims.sub === user.id)

  console.log("\n4) Cleanup")
  await client.send(new sdk.AdminDeleteUserCommand({ UserPoolId, Username: email }))
  check("test user deleted", true)
}

async function main() {
  let outputs
  try {
    outputs = await deploy()
    console.log("\nStack outputs:")
    console.log(outputs)
    await testRealCognito(outputs)
  } finally {
    await destroy()
  }

  console.log("")
  if (failures > 0) {
    console.log(`AWS tests FAILED with ${failures} failure(s)`)
    process.exit(1)
  }
  console.log("AWS tests passed")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})