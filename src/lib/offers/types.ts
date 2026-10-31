import type { Signals } from '../tenancy/context'
import type { ExclusiveTenant, TenantId } from '../tenancy/tenant'

export type Product = 'hysa' | 'ewa'

export type Rate = { apy: number } | { feeCents: number }

// Runtime tag carried by every offer: types are erased, so the gate reads this.
export type OfferScope = { kind: 'baseline' } | { kind: 'exclusive'; tenant: ExclusiveTenant }

export type BaselineOffer = {
  id: string
  product: Product
  scope: { kind: 'baseline' }
  eligible: (s: Signals) => boolean
}

// Collapses to `never` for tenants without exclusive offers, so a tenant0
// offer list cannot even express a Switchback-exclusive offer.
export type ExclusiveOffer<T extends TenantId> = T extends ExclusiveTenant
  ? {
      id: string
      product: Product
      scope: { kind: 'exclusive'; tenant: T }
      eligible: (s: Signals) => boolean
    }
  : never

export type OfferFor<T extends TenantId> = BaselineOffer | ExclusiveOffer<T>

export type PricedOffer<T extends TenantId> = OfferFor<T> & { rate: Rate; expiresAt: Date }
