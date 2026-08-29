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
new CognitoKitStack(app, stackName, {
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
app.synth()