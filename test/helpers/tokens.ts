import { SignJWT, generateKeyPair, type JWTPayload } from 'jose'
import type { IssuerConfig } from '../../src/lib/identity/jwt-authenticator'
import type { TenantId } from '../../src/lib/tenancy/tenant'
import { FIXED_NOW } from './clock'

export const SWITCHBACK_ISSUER = 'https://sso.switchback.example'
export const TENANT0_ISSUER = 'https://auth.tenant0.example'
export const AUDIENCE = 'offers-service'

type SignOpts = { expiresIn?: string; omitExp?: boolean; omitSub?: boolean; issuer?: string; audience?: string }

export async function makeTestIssuers() {
  const switchback = await generateKeyPair('RS256')
  const tenant0 = await generateKeyPair('RS256')
  const keys = { switchback, tenant0 } as const
  const issuerOf = { switchback: SWITCHBACK_ISSUER, tenant0: TENANT0_ISSUER } as const

  const issuers: IssuerConfig[] = [
    { issuer: SWITCHBACK_ISSUER, audience: AUDIENCE, tenant: 'switchback', publicKey: switchback.publicKey },
    { issuer: TENANT0_ISSUER, audience: AUDIENCE, tenant: 'tenant0', publicKey: tenant0.publicKey },
  ]

  // Signs with `tenant`'s private key. `opts.issuer` lets a test claim a
  // different issuer than the key that signed it.
  async function sign(tenant: TenantId, claims: JWTPayload = {}, opts: SignOpts = {}): Promise<string> {
    const iat = Math.floor(FIXED_NOW.getTime() / 1000)
    let jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(opts.issuer ?? issuerOf[tenant])
      .setAudience(opts.audience ?? AUDIENCE)
      .setIssuedAt(iat)
    if (!opts.omitSub) jwt = jwt.setSubject('user-1')
    if (!opts.omitExp) jwt = jwt.setExpirationTime(opts.expiresIn ? iat + seconds(opts.expiresIn) : iat + 300)
    return jwt.sign(keys[tenant].privateKey)
  }

  return { issuers, sign }
}

function seconds(spec: string): number {
  const m = /^(-?\d+)m$/.exec(spec)
  if (!m) throw new Error(`unsupported expiresIn: ${spec}`)
  return Number(m[1]) * 60
}
