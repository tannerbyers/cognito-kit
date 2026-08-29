import type {
  CognitoControlPlane,
  UserPoolClientInfo,
  UserPoolInfo,
  UserPoolSummary,
} from "./control-plane.js"

/**
 * A deterministic, offline implementation of {@link CognitoControlPlane}.
 *
 * Used by unit tests, local CLI workflows and future migration tests. It
 * behaves predictably and supports injected failures so that error paths can
 * be tested without touching AWS.
 */

export type FakeCognitoErrorKind = "not-found" | "api-failure" | "throttling" | "malformed"

export interface FakeCognitoError {
  kind: FakeCognitoErrorKind
  message: string
}

export interface FakeCognitoControlPlaneOptions {
  userPools: UserPoolInfo[]
  clients?: Record<string, UserPoolClientInfo[]>
  /** If set, every call throws this error (used to simulate outages). */
  failWith?: FakeCognitoError
}

function toError(e: FakeCognitoError): Error {
  const err = new Error(`${e.kind}: ${e.message}`) as Error & { kind: string }
  err.name = `CognitoFake${e.kind.replace(/-/g, "")}Error`
  ;(err as { kind: string }).kind = e.kind
  return err
}

export class FakeCognitoControlPlane implements CognitoControlPlane {
  private readonly userPools: Map<string, UserPoolInfo>
  private readonly clients: Map<string, UserPoolClientInfo[]>
  private readonly failWith?: FakeCognitoError

  constructor(options: FakeCognitoControlPlaneOptions) {
    this.userPools = new Map(options.userPools.map((p) => [p.userPoolId, p]))
    this.clients = new Map(
      Object.entries(options.clients ?? {}).map(([poolId, list]) => [poolId, list]),
    )
    this.failWith = options.failWith
  }

  private guard(): void {
    if (this.failWith) throw toError(this.failWith)
  }

  async describeUserPool(userPoolId: string): Promise<UserPoolInfo> {
    this.guard()
    const pool = this.userPools.get(userPoolId)
    if (!pool) throw toError({ kind: "not-found", message: `user pool ${userPoolId} not found` })
    return structuredClone(pool)
  }

  async describeUserPoolClient(userPoolId: string, clientId: string): Promise<UserPoolClientInfo> {
    this.guard()
    const list = this.clients.get(userPoolId)
    const client = list?.find((c) => c.clientId === clientId)
    if (!client) {
      throw toError({
        kind: "not-found",
        message: `client ${clientId} not found on pool ${userPoolId}`,
      })
    }
    return structuredClone(client)
  }

  async listUserPools(): Promise<UserPoolSummary[]> {
    this.guard()
    return [...this.userPools.values()].map((p) => ({ userPoolId: p.userPoolId, name: p.name }))
  }

  async listUserPoolClients(
    userPoolId: string,
  ): Promise<Array<{ clientId: string; clientName?: string }>> {
    this.guard()
    const list = this.clients.get(userPoolId) ?? []
    return list.map((c) => ({ clientId: c.clientId, clientName: c.clientName }))
  }
}
