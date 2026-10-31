import type { FastifyInstance } from 'fastify'
import type { Authenticator } from '../../lib/identity/authenticator'
import type { TenantContext } from '../../lib/tenancy/context'
import type { TenantId } from '../../lib/tenancy/tenant'

declare module 'fastify' {
  interface FastifyRequest {
    tenantContext: TenantContext<TenantId> | null
  }
}

// Registered on the root instance so the hook covers every route. Every
// request is untrusted: no tenant context, no further processing.
export function registerIdentity(app: FastifyInstance, authenticator: Authenticator): void {
  app.decorateRequest('tenantContext', null)
  app.addHook('onRequest', async (request, reply) => {
    const ctx = await authenticator.authenticate({ headers: request.headers })
    if (!ctx) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    request.tenantContext = ctx
  })
}
