import type { TenantId } from './tenant'

export type Signals = { tenureMonths: number; region: string }

// Module-private capability. Only code holding it can construct a context,
// and only mintTenantContext (imported solely by src/lib/identity/**) holds it.
const MINT: unique symbol = Symbol('TenantContext.mint')

export class TenantContext<T extends TenantId> {
  // ES private field: makes the class nominal for the compiler and gives a
  // runtime brand that object literals cannot fake.
  readonly #tenant: T
  readonly #userId: string
  readonly #signals: Signals

  constructor(token: symbol, tenant: T, userId: string, signals: Signals) {
    if (token !== MINT) {
      throw new Error('TenantContext can only be minted by the identity layer')
    }
    this.#tenant = tenant
    this.#userId = userId
    this.#signals = Object.freeze({ ...signals })
    // Frozen so a real context cannot be relabelled (e.g. an own `tenant` property).
    Object.freeze(this)
  }

  get tenant(): T {
    return this.#tenant
  }

  get userId(): string {
    return this.#userId
  }

  get signals(): Signals {
    return this.#signals
  }

  static isContext(x: object): boolean {
    return #tenant in x
  }
}

// Frozen so the tenant getter and isContext cannot be swapped out at runtime.
Object.freeze(TenantContext)
Object.freeze(TenantContext.prototype)

export function mintTenantContext<T extends TenantId>(tenant: T, userId: string, signals: Signals): TenantContext<T> {
  return new TenantContext(MINT, tenant, userId, signals)
}

export function isTenantContext(x: unknown): x is TenantContext<TenantId> {
  return typeof x === 'object' && x !== null && TenantContext.isContext(x)
}
