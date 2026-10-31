import { test } from 'vitest'
import type { TenantContext } from './context'

test('an object literal cannot stand in for a TenantContext', () => {
  // @ts-expect-error — private brand fields make TenantContext nominal
  const forged: TenantContext<'switchback'> = {
    tenant: 'switchback',
    userId: 'u-1',
    signals: { tenureMonths: 6, region: 'US' },
  }
  void forged
})
