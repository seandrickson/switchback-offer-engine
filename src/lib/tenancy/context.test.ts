import { describe, expect, it } from 'vitest'
import { TenantContext, isTenantContext, mintTenantContext } from './context'

const signals = { tenureMonths: 6, region: 'US' }

describe('TenantContext', () => {
  it('mints a context carrying tenant, userId and signals', () => {
    const ctx = mintTenantContext('switchback', 'u-1', signals)
    expect(ctx.tenant).toBe('switchback')
    expect(ctx.userId).toBe('u-1')
    expect(ctx.signals).toEqual(signals)
    expect(isTenantContext(ctx)).toBe(true)
  })

  it('cannot be constructed without the identity mint token', () => {
    expect(() => new TenantContext(Symbol('forged'), 'switchback', 'u-1', signals)).toThrow(/identity layer/)
  })

  it('rejects look-alike objects at runtime', () => {
    for (const x of [{ tenant: 'switchback', userId: 'u-1', signals }, null, undefined, 'switchback', 42]) {
      expect(isTenantContext(x)).toBe(false)
    }
  })
})
