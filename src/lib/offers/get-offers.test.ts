import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { FIXED_NOW } from '../../../test/helpers/clock'
import type { BreachReporter } from '../observability/breach'
import type { PricingClient, Quote } from '../pricing/client'
import { mintTenantContext } from '../tenancy/context'
import { PricingUnavailableError, getOffers } from './get-offers'

const IN_15_MIN = new Date(FIXED_NOW.getTime() + 15 * 60_000)
const ALL_IDS = ['hysa-baseline', 'ewa-baseline', 'hysa-switchback-plus', 'ewa-switchback-zero-fee']

const quoteFor = (offerId: string, expiresAt = IN_15_MIN): Quote => ({ offerId, rate: { apy: 4.1 }, expiresAt })

const t0 = mintTenantContext('tenant0', 'u-0', { tenureMonths: 12, region: 'US' })
const sb = mintTenantContext('switchback', 'u-1', { tenureMonths: 12, region: 'US' })
const sbNew = mintTenantContext('switchback', 'u-2', { tenureMonths: 0, region: 'CA' })

describe('getOffers', () => {
  let quote: Mock<PricingClient['quote']>
  let reporter: { report: Mock<BreachReporter['report']> }
  const deps = () => ({ pricing: { quote }, reporter, now: () => FIXED_NOW })

  beforeEach(() => {
    quote = vi.fn<PricingClient['quote']>(async (_tenant, ids) => ids.map((id) => quoteFor(id)))
    reporter = { report: vi.fn<BreachReporter['report']>() }
  })

  it('pricing cannot add an offer: rogue quotes for exclusive ids are ignored for tenant0', async () => {
    quote.mockResolvedValue(ALL_IDS.map((id) => quoteFor(id)))
    const res = await getOffers(t0, deps())
    const ids = res.offers.map((o) => o.id)
    expect(ids).toEqual(['hysa-baseline', 'ewa-baseline'])
    expect(ids).not.toContain('hysa-switchback-plus')
    expect(quote).toHaveBeenCalledWith('tenant0', ['hysa-baseline', 'ewa-baseline'])
    expect(reporter.report).not.toHaveBeenCalled()
  })

  it('only eligible offers are priced', async () => {
    await getOffers(sbNew, deps())
    expect(quote).toHaveBeenCalledWith('switchback', ['hysa-baseline'])
  })

  it('offers without a quote are omitted', async () => {
    quote.mockResolvedValue([quoteFor('hysa-baseline')])
    const res = await getOffers(t0, deps())
    expect(res.offers.map((o) => o.id)).toEqual(['hysa-baseline'])
  })

  it('expired quotes are omitted, including one expiring exactly now', async () => {
    quote.mockResolvedValue([quoteFor('hysa-baseline'), quoteFor('ewa-baseline', FIXED_NOW)])
    const res = await getOffers(t0, deps())
    expect(res.offers.map((o) => o.id)).toEqual(['hysa-baseline'])
  })

  it('duplicate quotes do not duplicate an offer', async () => {
    quote.mockResolvedValue([
      { offerId: 'hysa-baseline', rate: { apy: 4.1 }, expiresAt: IN_15_MIN },
      { offerId: 'hysa-baseline', rate: { apy: 9.9 }, expiresAt: IN_15_MIN },
    ])
    const res = await getOffers(t0, deps())
    expect(res.offers).toHaveLength(1)
    expect(res.offers[0]!.rate).toEqual({ apy: 4.1 })
  })

  it('response shape', async () => {
    const res = await getOffers(sb, deps())
    expect(res.generatedAt).toBe('2026-10-31T12:00:00.000Z')
    expect(res.count).toBe(res.offers.length)
    expect(res.count).toBe(4)
    for (const o of res.offers) {
      expect(o.expiresAt).toBe('2026-10-31T12:15:00.000Z')
      expect(Object.keys(o).sort()).toEqual(['expiresAt', 'id', 'kind', 'product', 'rate'])
    }
    expect(res.offers.find((o) => o.id === 'hysa-switchback-plus')!.kind).toBe('exclusive')
    expect(res.offers.find((o) => o.id === 'hysa-baseline')!.kind).toBe('baseline')
  })

  it('rejects when pricing is unavailable', async () => {
    quote.mockRejectedValue(new Error('upstream timeout'))
    await expect(getOffers(t0, deps())).rejects.toBeInstanceOf(PricingUnavailableError)
  })
})
