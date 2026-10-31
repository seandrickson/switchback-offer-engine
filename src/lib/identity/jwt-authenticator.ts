import { decodeJwt, jwtVerify, type JWTPayload } from 'jose'
import { mintTenantContext, type Signals } from '../tenancy/context'
import type { TenantId } from '../tenancy/tenant'
import type { Authenticator, AuthRequest } from './authenticator'

export type IssuerConfig = { issuer: string; audience: string; tenant: TenantId; publicKey: CryptoKey }

const BEARER = /^Bearer ([^\s]+)$/

export function createJwtAuthenticator(opts: { issuers: readonly IssuerConfig[]; now: () => Date }): Authenticator {
  return {
    async authenticate(req: AuthRequest) {
      try {
        const header = req.headers.authorization
        if (typeof header !== 'string') return null
        const token = BEARER.exec(header)?.[1]
        if (!token) return null

        // The unverified issuer only selects which key to verify with.
        const cfg = opts.issuers.find((i) => i.issuer === decodeJwt(token).iss)
        if (!cfg) return null

        const { payload } = await jwtVerify(token, cfg.publicKey, {
          algorithms: ['RS256'],
          issuer: cfg.issuer,
          audience: cfg.audience,
          requiredClaims: ['sub', 'exp'],
          currentDate: opts.now(),
        })

        // Tenant comes from the issuer that signed the token, never from a claim.
        if (payload.tenant !== undefined && payload.tenant !== cfg.tenant) return null

        return mintTenantContext(cfg.tenant, payload.sub!, signalsFrom(payload))
      } catch {
        return null
      }
    },
  }
}

function signalsFrom(payload: JWTPayload): Signals {
  const tenure = payload.tenure_months
  const region = payload.region
  return {
    tenureMonths: typeof tenure === 'number' && Number.isInteger(tenure) && tenure >= 0 ? tenure : 0,
    region: typeof region === 'string' && region.length > 0 ? region : 'unknown',
  }
}
