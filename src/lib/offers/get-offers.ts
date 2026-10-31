import type { BreachReporter } from '../observability/breach'
import type { PricingClient, Quote } from '../pricing/client'
import type { TenantContext } from '../tenancy/context'
import type { TenantId } from '../tenancy/tenant'
import { catalogFor } from './catalog'
import { enforceTenantIsolation } from './gate'
import type { PricedOffer, Product, Rate } from './types'

export type OffersDeps = { pricing: PricingClient; reporter: BreachReporter; now: () => Date }

export type OfferView = {
  id: string
  product: Product
  kind: 'baseline' | 'exclusive'
  rate: Rate
  expiresAt: string
}

export type OffersResponse = { generatedAt: string; count: number; offers: OfferView[] }

export class PricingUnavailableError extends Error {
  override name = 'PricingUnavailableError'
}

// Fixed step order (Template Method): catalog -> eligibility -> pricing ->
// gate -> view. Eligibility runs before pricing, and the gate always runs last.
export async function getOffers<T extends TenantId>(ctx: TenantContext<T>, deps: OffersDeps): Promise<OffersResponse> {
  const now = deps.now()

  const eligible = catalogFor(ctx).filter((offer) => offer.eligible(ctx.signals))

  let quotes: Quote[]
  try {
    quotes = await deps.pricing.quote(
      ctx.tenant,
      eligible.map((o) => o.id),
    )
  } catch (cause) {
    throw new PricingUnavailableError('Pricing service unavailable', { cause })
  }

  // Join over the offers we selected, never over the quotes: pricing can set a
  // rate but cannot add an offer. The first quote per offer wins.
  const priced: PricedOffer<T>[] = []
  for (const offer of eligible) {
    const quote = quotes.find((q) => q.offerId === offer.id)
    if (quote && quote.expiresAt.getTime() > now.getTime()) {
      priced.push({ ...offer, rate: quote.rate, expiresAt: quote.expiresAt })
    }
  }

  const offers = enforceTenantIsolation(ctx, priced, deps.reporter).map(
    (o): OfferView => ({
      id: o.id,
      product: o.product,
      kind: o.scope.kind,
      rate: o.rate,
      expiresAt: o.expiresAt.toISOString(),
    }),
  )

  return { generatedAt: now.toISOString(), count: offers.length, offers }
}
