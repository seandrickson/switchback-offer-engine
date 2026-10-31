import type { Rate } from '../offers/types'
import type { TenantId } from '../tenancy/tenant'

export type Quote = { offerId: string; rate: Rate; expiresAt: Date }

// Contract for the Supply squad's pricing/quoting service. Injected so the
// pipeline can be tested against a contract-first mock.
export interface PricingClient {
  quote(tenant: TenantId, offerIds: readonly string[]): Promise<Quote[]>
}
