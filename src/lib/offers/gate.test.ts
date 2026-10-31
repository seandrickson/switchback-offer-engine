import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { BreachReporter } from '../observability/breach'
import { mintTenantContext } from '../tenancy/context'
import { BASELINE_OFFERS, SWITCHBACK_EXCLUSIVE_OFFERS } from './catalog'
import { TenantIsolationError, enforceTenantIsolation } from './gate'
import type { OfferFor, PricedOffer } from './types'
import type { TenantId } from '../tenancy/tenant'

const hysaBaseline = BASELINE_OFFERS[0]!
const hysaSwitchbackPlus = SWITCHBACK_EXCLUSIVE_OFFERS[0]!

const priced = (offer: OfferFor<TenantId>): PricedOffer<TenantId> => ({
  ...offer,
  rate: { apy: 4 },
  expiresAt: new Date('2026-10-31T12:15:00Z'),
})

const signals = { tenureMonths: 12, region: 'US' }
const switchbackCtx = mintTenantContext('switchback', 'u-1', signals)

describe('enforceTenantIsolation', () => {
  let reporter: { report: Mock<BreachReporter['report']> }
  beforeEach(() => {
    reporter = { report: vi.fn<BreachReporter['report']>() }
  })

  it('BREACH: drops a Switchback-exclusive offer for a tenant0 user and keeps baseline', () => {
    const ctx = mintTenantContext('tenant0', 'u-0', signals)
    const out = enforceTenantIsolation(ctx, [priced(hysaBaseline), priced(hysaSwitchbackPlus)], reporter)
    expect(out.map((o) => o.id)).toEqual(['hysa-baseline'])
    expect(reporter.report).toHaveBeenCalledTimes(1)
    expect(reporter.report).toHaveBeenCalledWith({
      requestTenant: 'tenant0',
      offerId: 'hysa-switchback-plus',
      offerScope: { kind: 'exclusive', tenant: 'switchback' },
    })
  })

  it('fails closed on an unknown scope kind', () => {
    // the `as never` cast simulates bad runtime data that slipped past the types
    const rogue = { ...priced(hysaBaseline), id: 'rogue', scope: { kind: 'partner' } } as never
    const out = enforceTenantIsolation(switchbackCtx, [rogue, priced(hysaBaseline)], reporter)
    expect(out.map((o) => o.id)).toEqual(['hysa-baseline'])
    expect(reporter.report).toHaveBeenCalledWith(expect.objectContaining({ offerId: 'rogue' }))
  })

  it('throws on a forged context', () => {
    const forged = { tenant: 'switchback', userId: 'x', signals: {} } as never
    expect(() => enforceTenantIsolation(forged, [priced(hysaBaseline)], reporter)).toThrow(TenantIsolationError)
  })

  it('passes Switchback exclusives to Switchback users without reporting', () => {
    const out = enforceTenantIsolation(switchbackCtx, [priced(hysaBaseline), priced(hysaSwitchbackPlus)], reporter)
    expect(out.map((o) => o.id)).toEqual(['hysa-baseline', 'hysa-switchback-plus'])
    expect(reporter.report).not.toHaveBeenCalled()
  })
})
