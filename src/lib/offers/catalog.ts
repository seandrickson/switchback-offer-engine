import type { TenantContext } from '../tenancy/context'
import { assertNever, type TenantId } from '../tenancy/tenant'
import type { BaselineOffer, ExclusiveOffer, OfferFor } from './types'

export const BASELINE_OFFERS: readonly BaselineOffer[] = Object.freeze([
  { id: 'hysa-baseline', product: 'hysa', scope: { kind: 'baseline' }, eligible: () => true },
  { id: 'ewa-baseline', product: 'ewa', scope: { kind: 'baseline' }, eligible: (s) => s.tenureMonths >= 3 },
])

export const SWITCHBACK_EXCLUSIVE_OFFERS: readonly ExclusiveOffer<'switchback'>[] = Object.freeze([
  {
    id: 'hysa-switchback-plus',
    product: 'hysa',
    scope: { kind: 'exclusive', tenant: 'switchback' },
    eligible: (s) => s.tenureMonths >= 1,
  },
  {
    id: 'ewa-switchback-zero-fee',
    product: 'ewa',
    scope: { kind: 'exclusive', tenant: 'switchback' },
    eligible: (s) => s.region === 'US',
  },
])

export function catalogFor<T extends TenantId>(ctx: TenantContext<T>): OfferFor<T>[] {
  // TypeScript does not narrow the generic T from this switch, so each branch
  // casts; types.test-d.ts pins the resulting return types per tenant.
  const tenant: TenantId = ctx.tenant
  switch (tenant) {
    case 'tenant0':
      return [...BASELINE_OFFERS] as OfferFor<T>[]
    case 'switchback':
      return [...BASELINE_OFFERS, ...SWITCHBACK_EXCLUSIVE_OFFERS] as OfferFor<T>[]
    default:
      return assertNever(tenant)
  }
}
