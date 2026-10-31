import type { BreachReporter } from '../observability/breach'
import { isTenantContext, type TenantContext } from '../tenancy/context'
import type { TenantId } from '../tenancy/tenant'
import type { PricedOffer } from './types'

export class TenantIsolationError extends Error {
  override name = 'TenantIsolationError'
}

// Last check before offers leave the service. It assumes every layer above it
// failed: input is typed wide on purpose because at runtime it is untrusted.
export function enforceTenantIsolation<T extends TenantId>(
  ctx: TenantContext<T>,
  offers: readonly PricedOffer<TenantId>[],
  reporter: BreachReporter,
): PricedOffer<T>[] {
  if (!isTenantContext(ctx)) {
    throw new TenantIsolationError('Untrusted tenant context reached the isolation gate')
  }

  const allowed = offers.filter((offer) => {
    const scope = offer.scope as { kind?: unknown; tenant?: unknown }
    const entitled = scope.kind === 'baseline' || (scope.kind === 'exclusive' && scope.tenant === ctx.tenant)
    if (!entitled) {
      reporter.report({ requestTenant: ctx.tenant, offerId: offer.id, offerScope: offer.scope })
    }
    return entitled
  })

  // Safe because the runtime check above admitted only baseline offers and
  // exclusives scoped to ctx.tenant.
  return allowed as PricedOffer<T>[]
}
