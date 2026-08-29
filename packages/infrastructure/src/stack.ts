import { CfnOutput, Stack } from "aws-cdk-lib"
import type { StackProps } from "aws-cdk-lib"
import { Construct } from "constructs"
import { CognitoKitAuth, type CognitoKitAuthProps } from "./construct.js"

/**
 * A ready-to-deploy stack that wraps {@link CognitoKitAuth} and emits the
 * outputs applications need (pool id, client id, issuer, domain).
 *
 * This is the canonical way to deploy the generated infrastructure into the
 * user's own AWS account.
 */
export class CognitoKitStack extends Stack {
  readonly auth: CognitoKitAuth

  constructor(scope: Construct, id: string, props: StackProps & { auth: CognitoKitAuthProps }) {
    const { auth, ...stackProps } = props
    super(scope, id, stackProps)

    this.auth = new CognitoKitAuth(this, "Auth", auth)

    new CfnOutput(this, "UserPoolId", { value: this.auth.userPool.userPoolId })
    new CfnOutput(this, "UserPoolClientId", { value: this.auth.userPoolClient.userPoolClientId })
    new CfnOutput(this, "Issuer", { value: this.auth.issuer })
    new CfnOutput(this, "Domain", { value: this.auth.userPoolDomain.domainName })
  }
}
