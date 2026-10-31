// Closed set of tenants. Adding one is a deliberate change: every exhaustive
// switch ending in assertNever stops compiling until it handles the new tenant.
export type TenantId = 'tenant0' | 'switchback'

// Tenants that have exclusive offers of their own.
export type ExclusiveTenant = 'switchback'

export function assertNever(x: never): never {
  throw new Error('Unhandled tenant: ' + String(x))
}
