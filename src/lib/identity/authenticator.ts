import type { TenantContext } from '../tenancy/context'
import type { TenantId } from '../tenancy/tenant'

export type AuthRequest = { headers: Record<string, string | string[] | undefined> }

// Strategy: one interface per auth scheme. Implementations live in
// src/lib/identity/ because only this layer may mint tenant contexts.
export interface Authenticator {
  authenticate(req: AuthRequest): Promise<TenantContext<TenantId> | null>
}
