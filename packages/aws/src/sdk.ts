/**
 * Re-exports the AWS SDK client and the commands the cognito-kit AWS test
 * layer needs. Importing this subpath loads the AWS SDK; the main entry point
 * does not.
 */
export {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AdminDeleteUserCommand,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  DeleteUserPoolCommand,
  DescribeUserPoolCommand,
  DescribeUserPoolClientCommand,
  ListUserPoolsCommand,
  ListUserPoolClientsCommand,
} from "@aws-sdk/client-cognito-identity-provider"