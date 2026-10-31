import type { TenantId } from '../tenancy/tenant'

export type TenantIsolationBreach = {
  requestTenant: TenantId
  offerId: string
  offerScope: unknown
}

// Observer: the gate publishes breaches without knowing who listens. In
// production this is a New Relic custom event whose alert pages Sev-1 via Rootly.
export interface BreachReporter {
  report(e: TenantIsolationBreach): void
}
