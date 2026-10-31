import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { FIXED_NOW } from '../../test/helpers/clock'
import { makeTestIssuers } from '../../test/helpers/tokens'
import type { Authenticator } from '../lib/identity/authenticator'
import { createJwtAuthenticator } from '../lib/identity/jwt-authenticator'
import type { BreachReporter } from '../lib/observability/breach'
import type { PricingClient } from '../lib/pricing/client'
import { buildApp } from './app'

const IN_15_MIN = new Date(FIXED_NOW.getTime() + 15 * 60_000)

let issuers: Awaited<ReturnType<typeof makeTestIssuers>>
let quote: Mock<PricingClient['quote']>
let reporter: { report: Mock<BreachReporter['report']> }

beforeAll(async () => {
  issuers = await makeTestIssuers()
})

beforeEach(() => {
  quote = vi.fn<PricingClient['quote']>(async (_t, ids) => ids.map((offerId) => ({ offerId, rate: { apy: 4.1 }, expiresAt: IN_15_MIN })))
  reporter = { report: vi.fn<BreachReporter['report']>() }
})

const app = (authenticator?: Authenticator) =>
  buildApp({
    authenticator: authenticator ?? createJwtAuthenticator({ issuers: issuers.issuers, now: () => FIXED_NOW }),
    pricing: { quote },
    reporter,
    now: () => FIXED_NOW,
  })

const getOffers = async (headers: Record<string, string> = {}, authenticator?: Authenticator) =>
  app(authenticator).inject({ method: 'GET', url: '/offers', headers })

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('GET /offers', () => {
  it('serves tenant0 baseline offers and never a Switchback exclusive', async () => {
    const res = await getOffers(bearer(await issuers.sign('tenant0', { tenure_months: 12, region: 'US' })))
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const ids: string[] = body.offers.map((o: { id: string }) => o.id)
    expect(ids).toEqual(['hysa-baseline', 'ewa-baseline'])
    expect(body.count).toBe(body.offers.length)
    expect(body.generatedAt).toBe('2026-10-31T12:00:00.000Z')
  })

  it('serves Switchback users their exclusive offers', async () => {
    const res = await getOffers(bearer(await issuers.sign('switchback', { tenure_months: 6, region: 'US' })))
    expect(res.statusCode).toBe(200)
    const ids: string[] = res.json().offers.map((o: { id: string }) => o.id)
    expect(ids).toEqual(expect.arrayContaining(['hysa-switchback-plus', 'ewa-switchback-zero-fee']))
  })

  it('rejects a request without a token before pricing is called', async () => {
    const res = await getOffers()
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
    expect(quote).not.toHaveBeenCalled()
  })

  it('returns 503 with no offers when pricing is unavailable', async () => {
    quote.mockRejectedValue(new Error('upstream timeout'))
    const res = await getOffers(bearer(await issuers.sign('tenant0')))
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'pricing_unavailable' })
  })

  it('returns a generic 500 with no offers when a forged context reaches the gate', async () => {
    const forged = { tenant: 'switchback', userId: 'x', signals: { tenureMonths: 9, region: 'US' } }
    const rogueAuth = { authenticate: async () => forged } as unknown as Authenticator
    const res = await getOffers({}, rogueAuth)
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'internal' })
  })
})
