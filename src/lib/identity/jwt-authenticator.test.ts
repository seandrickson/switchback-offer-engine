import { SignJWT, UnsecuredJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { FIXED_NOW } from '../../../test/helpers/clock'
import { AUDIENCE, TENANT0_ISSUER, makeTestIssuers } from '../../../test/helpers/tokens'
import { isTenantContext } from '../tenancy/context'
import type { Authenticator } from './authenticator'
import { createJwtAuthenticator } from './jwt-authenticator'

let auth: Authenticator
let sign: Awaited<ReturnType<typeof makeTestIssuers>>['sign']

beforeAll(async () => {
  const t = await makeTestIssuers()
  sign = t.sign
  auth = createJwtAuthenticator({ issuers: t.issuers, now: () => FIXED_NOW })
})

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

describe('JwtAuthenticator', () => {
  it('mints a switchback context from a valid Switchback token', async () => {
    const ctx = await auth.authenticate(bearer(await sign('switchback', { tenure_months: 6, region: 'US' })))
    expect(isTenantContext(ctx)).toBe(true)
    expect(ctx!.tenant).toBe('switchback')
    expect(ctx!.userId).toBe('user-1')
    expect(ctx!.signals).toEqual({ tenureMonths: 6, region: 'US' })
  })

  it('mints a tenant0 context from a valid tenant0 token', async () => {
    const ctx = await auth.authenticate(bearer(await sign('tenant0')))
    expect(ctx!.tenant).toBe('tenant0')
  })

  it('derives tenant from the issuer: a tenant claim that disagrees is rejected', async () => {
    const ctx = await auth.authenticate(bearer(await sign('tenant0', { tenant: 'switchback' })))
    expect(ctx).toBeNull()
  })

  it('falls back to safe signals when claims are malformed', async () => {
    const ctx = await auth.authenticate(bearer(await sign('switchback', { tenure_months: -1, region: 42 })))
    expect(ctx!.signals).toEqual({ tenureMonths: 0, region: 'unknown' })
  })

  const tamper = (token: string) => {
    const [h, p, s] = token.split('.')
    const mid = Math.floor(p!.length / 2)
    const flipped = p![mid] === 'A' ? 'B' : 'A'
    return `${h}.${p!.slice(0, mid)}${flipped}${p!.slice(mid + 1)}.${s}`
  }

  const iat = Math.floor(FIXED_NOW.getTime() / 1000)
  const rejected: Array<[string, () => Promise<Record<string, string | undefined>>]> = [
    ['missing header', async () => ({})],
    ['empty header', async () => ({ authorization: '' })],
    ['Basic scheme', async () => ({ authorization: 'Basic abc' })],
    ['Bearer with no token', async () => ({ authorization: 'Bearer' })],
    ['non-JWT bearer', async () => ({ authorization: 'Bearer not-a-jwt' })],
    ['expired token', async () => bearer(await sign('switchback', {}, { expiresIn: '-1m' })).headers],
    [
      'Switchback key claiming the tenant0 issuer',
      async () => bearer(await sign('switchback', {}, { issuer: TENANT0_ISSUER })).headers,
    ],
    ['payload tampered after signing', async () => bearer(tamper(await sign('switchback'))).headers],
    ['unknown issuer', async () => bearer(await sign('switchback', {}, { issuer: 'https://evil.example' })).headers],
    ['wrong audience', async () => bearer(await sign('switchback', {}, { audience: 'other-service' })).headers],
    [
      'alg none',
      async () =>
        bearer(
          new UnsecuredJWT({}).setIssuer(TENANT0_ISSUER).setAudience(AUDIENCE).setSubject('u').setIssuedAt(iat).setExpirationTime(iat + 300).encode(),
        ).headers,
    ],
    [
      'HS256 token',
      async () =>
        bearer(
          await new SignJWT({})
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuer(TENANT0_ISSUER)
            .setAudience(AUDIENCE)
            .setSubject('u')
            .setIssuedAt(iat)
            .setExpirationTime(iat + 300)
            .sign(new TextEncoder().encode('x'.repeat(32))),
        ).headers,
    ],
    ['token without exp', async () => bearer(await sign('switchback', {}, { omitExp: true })).headers],
    ['token without sub', async () => bearer(await sign('switchback', {}, { omitSub: true })).headers],
  ]

  it.each(rejected)('rejects %s with null and never throws', async (_name, headers) => {
    await expect(auth.authenticate({ headers: await headers() })).resolves.toBeNull()
  })
})
