import type { FastifyInstance } from 'fastify'
import { PricingUnavailableError, getOffers, type OffersDeps } from '../../lib/offers/get-offers'

export function registerOffersRoute(app: FastifyInstance, deps: OffersDeps): void {
  app.get('/offers', async (request, reply) => {
    try {
      // Non-null: the identity hook rejects any request without a context.
      return await getOffers(request.tenantContext!, deps)
    } catch (err) {
      if (err instanceof PricingUnavailableError) {
        return reply.code(503).send({ error: 'pricing_unavailable' })
      }
      throw err
    }
  })
}
