import { CfnOutput, App } from "aws-cdk-lib"
import * as Cognito from "aws-cdk-lib/aws-cognito"
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

// A second, secretless public client for the smoke test. ADMIN auth against a
// confidential client requires SECRET_HASH (which requires the secret, which
// CloudFormation does not expose after creation). A public client exercises
// the exact same token/verification path without that plumbing.
const publicClient = new Cognito.UserPoolClient(stack, "SmokeTestPublicClient", {
  userPool: stack.auth.userPool,
  userPoolClientName: "smoke-test",
  generateSecret: false,
  preventUserExistenceErrors: true,
  supportedIdentityProviders: [Cognito.UserPoolClientIdentityProvider.COGNITO],
  oAuth: {
    flows: { authorizationCodeGrant: true },
    scopes: [Cognito.OAuthScope.OPENID, Cognito.OAuthScope.EMAIL],
    callbackUrls: ["http://localhost:3000/auth/callback"],
    logoutUrls: ["http://localhost:3000"],
  },
})
const cfnPublic = publicClient.node.defaultChild
cfnPublic.addPropertyOverride("ExplicitAuthFlows", ["ALLOW_ADMIN_USER_PASSWORD_AUTH"])
cfnPublic.addPropertyOverride("AllowedOAuthFlowsUserPoolClient", true)

new CfnOutput(stack, "SmokeTestClientId", { value: publicClient.userPoolClientId })

app.synth()