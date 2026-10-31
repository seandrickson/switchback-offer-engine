import { describe, expect, it } from 'vitest'
import { mintTenantContext } from '../tenancy/context'
import { BASELINE_OFFERS, SWITCHBACK_EXCLUSIVE_OFFERS, catalogFor } from './catalog'

const signals = { tenureMonths: 12, region: 'US' }

describe('catalogFor', () => {
  it('gives tenant0 only baseline offers', () => {
    const offers = catalogFor(mintTenantContext('tenant0', 'u-0', signals))
    expect(offers.map((o) => o.id)).toEqual(['hysa-baseline', 'ewa-baseline'])
    expect(offers.every((o) => o.scope.kind === 'baseline')).toBe(true)
  })

  it('gives switchback baseline plus its own exclusive offers', () => {
    const offers = catalogFor(mintTenantContext('switchback', 'u-1', signals))
    expect(offers.map((o) => o.id)).toEqual(
      expect.arrayContaining(['hysa-baseline', 'ewa-baseline', 'hysa-switchback-plus', 'ewa-switchback-zero-fee']),
    )
    for (const o of offers) {
      if (o.scope.kind === 'exclusive') expect(o.scope.tenant).toBe('switchback')
    }
  })

  it('has unique offer ids across all catalogs', () => {
    const ids = [...BASELINE_OFFERS, ...SWITCHBACK_EXCLUSIVE_OFFERS].map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
