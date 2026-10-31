import Fastify, { type FastifyInstance } from 'fastify'
import type { Authenticator } from '../lib/identity/authenticator'
import type { OffersDeps } from '../lib/offers/get-offers'
import { registerIdentity } from './plugins/identity'
import { registerOffersRoute } from './routes/offers'

export type AppDeps = OffersDeps & { authenticator: Authenticator }

// Builds the app without listening; tests drive it with app.inject().
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })

  registerIdentity(app, deps.authenticator)
  registerOffersRoute(app, deps)

  // Never leak error details (including isolation failures) to the client.
  app.setErrorHandler((err, request, reply) => {
    request.log.error(err)
    return reply.code(500).send({ error: 'internal' })
  })

  return app
}
