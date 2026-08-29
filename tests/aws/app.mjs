import { App } from "aws-cdk-lib"
import { CognitoKitStack } from "@cognito-kit/infrastructure"

/**
 * CDK app used by `pnpm test:aws`. Synthesizes the temporary stack that the
 * real-AWS integration tests deploy and destroy.
 *
 * Environment:
 *   CK_TEST_STACK   - stack name (default: CognitoKitAwsTest)
 *   CK_TEST_SUFFIX  - random suffix for the pool/domain name (default: timestamp)
 *   AWS_REGION / AWS_DEFAULT_REGION
 */
const stackName = process.env.CK_TEST_STACK ?? "CognitoKitAwsTest"
const suffix = process.env.CK_TEST_SUFFIX ?? Date.now().toString(36)
const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1"

const app = new App()
const stack = new CognitoKitStack(app, stackName, {
  env: { region },
  auth: {
    name: `cktest-${suffix}`,
    signIn: "email",
    application: {
      type: "web",
      callbackUrls: ["http://localhost:3000/auth/callback"],
      logoutUrls: ["http://localhost:3000"],
    },
  },
})

// The test flow authenticates via AdminInitiateAuth, which requires the
// admin password auth flow on the app client. This is test-only; the
// construct's safe defaults intentionally do not enable it.
const cfnClient = stack.auth.userPoolClient.node.defaultChild
cfnClient.addPropertyOverride("ExplicitAuthFlows", ["ALLOW_ADMIN_USER_PASSWORD_AUTH"])

app.synth()