/**
 * Layer 5 — AWS tests.
 *
 * Two modes:
 *
 *   real (default)  Deploy a temporary stack to real AWS, exercise real
 *                   Cognito, verify the runtime contract, destroy the stack.
 *                   Requires COGNITO_KIT_AWS_TESTS=1 + AWS credentials.
 *
 *   --local         Run the same flow against cognito-local: a free,
 *                   open-source Cognito emulator (by the LocalStack team)
 *                   running in Docker. No AWS account, no credentials, no
 *                   Docker for the rest of the suite.
 *
 *                   What --local validates:
 *                     - the full auth flow against a real HTTP Cognito API
 *                     - the runtime contract (OIDC discovery + JWKS +
 *                       signature verification) against real tokens
 *                     - the AwsCognitoControlPlane adapter + toNormalizedPool
 *                       against real API responses
 *                   What it does NOT validate (real AWS only):
 *                     - CloudFormation deployment of the synthesized template
 *                     - actual Cognito service behavior
 *
 * Run:
 *   pnpm test:aws            # real AWS (gated)
 *   pnpm test:aws --local    # cognito-local emulator (needs Docker)
 */
import { execSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const mode = process.argv.includes("--local") ? "local" : "real"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const EMULATOR_IMAGE = process.env.COGNITO_LOCAL_IMAGE ?? "jagregory/cognito-local:latest"
const EMULATOR_CONTAINER = "cognito-kit-cognito-local"
const EMULATOR_PORT = 9229

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(url, timeoutMs = 120000, label = url) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* not ready yet */
    }
    await sleep(1000)
  }
  throw new Error(`timed out waiting for ${label}`)
}

/**
 * The flow shared by both modes: create a user, authenticate, verify the ID
 * token with the runtime contract, normalize, clean up.
 */
async function runCognitoFlow({ client, poolId, clientId, issuer }) {
  const email = `ck-test-${suffix}@example.com`
  const password = "Ck-Test-12345!"

  console.log("\n1) Create a Cognito user (admin API)")
  await client.send(
    new (await import("@cognito-kit/aws/sdk")).AdminCreateUserCommand({
      UserPoolId: poolId,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
      ],
      MessageAction: "SUPPRESS",
    }),
  )
  await client.send(
    new (await import("@cognito-kit/aws/sdk")).AdminSetUserPasswordCommand({
      UserPoolId: poolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  )
  check("user created", true)

  console.log("\n2) Authenticate and obtain an ID token")
  const auth = await client.send(
    new (await import("@cognito-kit/aws/sdk")).AdminInitiateAuthCommand({
      UserPoolId: poolId,
      ClientId: clientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  )
  const idToken = auth.AuthenticationResult?.IdToken
  check("id token issued", Boolean(idToken))

  console.log("\n3) Verify with the runtime contract (same as local-auth)")
  const { createRemoteTokenVerifier, normalizeUser } = await import("@cognito-kit/runtime")
  const verifier = createRemoteTokenVerifier({
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    audience: clientId,
  })
  const { payload } = await verifier.verify(idToken)
  const user = normalizeUser(payload)
  check("issuer matches", payload.iss === issuer, String(payload.iss))
  check("sub present", Boolean(user.id))
  check("email claim matches", user.email === email, String(user.email))
  check("email verified", user.emailVerified === true, String(user.emailVerified))
  check("normalized user shape", user.id && user.email && user.claims.sub === user.id)

  console.log("\n4) Cleanup")
  await client.send(
    new (await import("@cognito-kit/aws/sdk")).AdminDeleteUserCommand({
      UserPoolId: poolId,
      Username: email,
    }),
  )
  check("test user deleted", true)
}

/* ------------------------------ local mode ------------------------------ */

const EMULATOR_CONFIG = `userPool:
  id: us-east-1_testpool
  name: test
  region: us-east-1
  signingKey: testkey
  email: test@example.com
  passwordPolicy:
    minimumLength: 8
    requireLowercase: true
    requireNumbers: true
    requireSymbols: false
    requireUppercase: true
`

async function runLocal() {
  console.log(`\ncognito-local emulator mode (image: ${EMULATOR_IMAGE})`)
  console.log("No AWS account required.")

  let configDir
  try {
    // 1. Start the emulator in Docker.
    execSync(`docker rm -f ${EMULATOR_CONTAINER} >/dev/null 2>&1 || true`)
    configDir = mkdtempSync(join(tmpdir(), "ck-cognito-local-"))
    writeFileSync(join(configDir, "cognito-local.yml"), EMULATOR_CONFIG, "utf8")
    run(
      `docker run -d --name ${EMULATOR_CONTAINER} -p ${EMULATOR_PORT}:9229 -v ${configDir}/cognito-local.yml:/app/cognito-local.yml ${EMULATOR_IMAGE}`,
    )
    await waitFor(`http://localhost:${EMULATOR_PORT}/health`, 120000, "cognito-local")

    // 2. Create the pool + client via the Cognito API (the CDK template
    //    would create the same resources; CloudFormation itself is only
    //    exercised against real AWS). The create parameters mirror the
    //    construct's safe defaults so the emulator echoes them back.
    const sdk = await import("@cognito-kit/aws/sdk")
    const client = new sdk.CognitoIdentityProviderClient({
      region: "us-east-1",
      endpoint: `http://localhost:${EMULATOR_PORT}`,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    })
    const pool = await client.send(
      new sdk.CreateUserPoolCommand({
        PoolName: `cktest-${suffix}`,
        AliasAttributes: ["email"],
        UsernameConfiguration: { CaseSensitive: false },
        AutoVerifiedAttributes: ["email"],
        Schema: [{ Name: "email", AttributeDataType: "String", Required: true, Mutable: false }],
      }),
    )
    const poolId = pool.UserPool.Id
    const clientRes = await client.send(
      new sdk.CreateUserPoolClientCommand({
        UserPoolId: poolId,
        ClientName: "app",
        ExplicitAuthFlows: ["ALLOW_ADMIN_USER_PASSWORD_AUTH"],
      }),
    )
    const clientId = clientRes.UserPoolClient.ClientId
    const issuer = `http://localhost:${EMULATOR_PORT}/${poolId}`
    console.log(`\nPool: ${poolId}\nClient: ${clientId}\nIssuer: ${issuer}`)

    // 3. The shared auth flow.
    await runCognitoFlow({ client, poolId, clientId, issuer })

    // 4. The control-plane adapter against the emulator's HTTP API.
    console.log("\n5) Control-plane adapter against the emulator")
    const { AwsCognitoControlPlane, toNormalizedPool } = await import("@cognito-kit/aws")
    const plane = new AwsCognitoControlPlane({
      region: "us-east-1",
      endpoint: `http://localhost:${EMULATOR_PORT}`,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    })
    const poolInfo = await plane.describeUserPool(poolId)
    const clientInfo = await plane.describeUserPoolClient(poolId, clientId)
    check("describeUserPool returns the pool", poolInfo.userPoolId === poolId)
    check("describeUserPoolClient returns the client", clientInfo.clientId === clientId)

    const { diagnoseUserPool } = await import("@cognito-kit/core")
    const normalized = toNormalizedPool(poolInfo, clientInfo)
    const report = diagnoseUserPool(normalized)
    check("toNormalizedPool produces a diagnosable document", report.summary.critical === 0)

    // 5. Cleanup.
    console.log("\n6) Cleanup")
    await client.send(new sdk.DeleteUserPoolCommand({ UserPoolId: poolId }))
    check("user pool deleted", true)
  } finally {
    execSync(`docker rm -f ${EMULATOR_CONTAINER} >/dev/null 2>&1 || true`)
    if (configDir) execSync(`rm -rf ${configDir}`)
  }
}

/* ------------------------------- real mode ------------------------------ */

async function runReal() {
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

  const stackName = `CognitoKitAwsTest${suffix}`
  const outputsFile = join(tmpdir(), `ck-aws-outputs-${suffix}.json`)

  let outputs
  try {
    run(
      `npx aws-cdk bootstrap aws://${process.env.AWS_ACCOUNT_ID ?? "unknown"}/${region} --region ${region}`,
    )
    run(
      `npx aws-cdk deploy ${stackName} --app "node tests/aws/app.mjs" --require-approval never --outputs-file ${outputsFile} --region ${region}`,
    )
    outputs = JSON.parse(readFileSync(outputsFile, "utf8"))[stackName]
    console.log("\nStack outputs:")
    console.log(outputs)

    const sdk = await import("@cognito-kit/aws/sdk")
    const client = new sdk.CognitoIdentityProviderClient({ region })
    await runCognitoFlow({
      client,
      poolId: outputs.UserPoolId,
      clientId: outputs.UserPoolClientId,
      issuer: outputs.Issuer,
    })
  } finally {
    run(`npx aws-cdk destroy ${stackName} --app "node tests/aws/app.mjs" --force --region ${region}`)
  }
}

/* --------------------------------- main --------------------------------- */

async function main() {
  if (mode === "local") {
    await runLocal()
  } else {
    await runReal()
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