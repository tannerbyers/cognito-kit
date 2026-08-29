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
 *                   open-source Cognito emulator (by the LocalStack team).
 *                   No AWS account, no credentials, no Docker.
 *
 *                   What --local validates:
 *                     - OIDC discovery + the full auth flow against a real
 *                       HTTP Cognito API
 *                     - the runtime contract (JWKS + signature verification)
 *                       against real tokens
 *                     - the AwsCognitoControlPlane adapter + toNormalizedPool
 *                       against real API responses
 *                   What it does NOT validate (real AWS only):
 *                     - CloudFormation deployment of the synthesized template
 *                     - actual Cognito service behavior
 *
 * Run:
 *   pnpm test:aws            # real AWS (gated)
 *   pnpm test:aws --local    # cognito-local emulator
 */
import { spawn } from "node:child_process"
import { execSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const mode = process.argv.includes("--local") ? "local" : "real"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const EMULATOR_PORT = 9229
const LOCAL_BIN = join(root, "node_modules", ".bin", "cognito-local")

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
 * The flow shared by both modes: create a user, authenticate, then verify the
 * ID token using the OIDC discovery document + JWKS — exactly how a real
 * application consumes the auth contract.
 */
async function runCognitoFlow({ client, poolId, clientId, discoveryUrl }) {
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

  console.log("\n3) Verify with the runtime contract (OIDC discovery + JWKS)")
  const doc = await fetch(discoveryUrl).then((r) => {
    if (!r.ok) throw new Error(`discovery failed: HTTP ${r.status}`)
    return r.json()
  })
  if (!doc.issuer || !doc.jwks_uri) {
    throw new Error(`discovery document at ${discoveryUrl} is missing issuer or jwks_uri`)
  }
  const { createRemoteTokenVerifier, normalizeUser } = await import("@cognito-kit/runtime")
  const { payload } = await createRemoteTokenVerifier({
    issuer: doc.issuer,
    jwksUrl: doc.jwks_uri,
    audience: clientId,
  }).verify(idToken)
  const user = normalizeUser(payload)
  check("issuer from discovery matches token", payload.iss === doc.issuer, String(payload.iss))
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
`

async function runLocal() {
  console.log("\ncognito-local emulator mode — no AWS account required.")

  let configDir
  let emulator
  try {
    // 1. Start the emulator as a local process in a scratch directory.
    configDir = mkdtempSync(join(tmpdir(), "ck-cognito-local-"))
    writeFileSync(join(configDir, "cognito-local.yml"), EMULATOR_CONFIG, "utf8")
    emulator = spawn(LOCAL_BIN, [], {
      cwd: configDir,
      env: { ...process.env, PORT: String(EMULATOR_PORT) },
      stdio: "inherit",
    })
    await waitFor(`http://localhost:${EMULATOR_PORT}/health`, 60000, "cognito-local")

    // 2. Create the pool + client via the Cognito API (the CDK template
    //    would create the same resources; CloudFormation itself is only
    //    exercised against real AWS). The create parameters mirror the
    //    construct's safe defaults so the emulator surfaces them.
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
    console.log(`\nPool: ${poolId}\nClient: ${clientId}`)

    // 3. The shared auth flow (discovery-driven).
    await runCognitoFlow({
      client,
      poolId,
      clientId,
      discoveryUrl: `http://localhost:${EMULATOR_PORT}/${poolId}/.well-known/openid-configuration`,
    })

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
    if (emulator) emulator.kill("SIGTERM")
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
  const { CognitoIdentityProviderClient } = await import("@cognito-kit/aws/sdk")

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

    await runCognitoFlow({
      client: new CognitoIdentityProviderClient({ region }),
      poolId: outputs.UserPoolId,
      clientId: outputs.UserPoolClientId,
      discoveryUrl: `${outputs.Issuer}/.well-known/openid-configuration`,
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
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})