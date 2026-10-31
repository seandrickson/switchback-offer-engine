import { expectTypeOf, test } from 'vitest'
import { SWITCHBACK_EXCLUSIVE_OFFERS, catalogFor } from './catalog'
import type { BaselineOffer, ExclusiveOffer, OfferFor } from './types'

test('tenant0 can only ever hold baseline offers', () => {
  expectTypeOf<OfferFor<'tenant0'>>().toEqualTypeOf<BaselineOffer>()
  expectTypeOf<ExclusiveOffer<'tenant0'>>().toBeNever()
})

test('a Switchback exclusive cannot be placed in a tenant0 offer list', () => {
  const exclusive = SWITCHBACK_EXCLUSIVE_OFFERS[0]!
  // @ts-expect-error — Switchback-exclusive offer is not assignable to tenant0
  const leaked: OfferFor<'tenant0'>[] = [exclusive]
  void leaked
})

test('catalogFor is typed by the context tenant', () => {
  expectTypeOf(catalogFor<'tenant0'>).returns.toEqualTypeOf<BaselineOffer[]>()
  expectTypeOf(catalogFor<'switchback'>).returns.toEqualTypeOf<OfferFor<'switchback'>[]>()
})
