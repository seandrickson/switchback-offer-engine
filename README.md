# switchback-offer-engine

A small slice of the offers service: the **tenant-isolation guardrail**. It guarantees that a Switchback-exclusive offer can never be returned to a tenant-0 user and can never leak across tenants.

- Design: [`docs/superpowers/specs/2026-10-31-tenant-isolation-guardrail-design.md`](docs/superpowers/specs/2026-10-31-tenant-isolation-guardrail-design.md)
- Decisions, harden-next, how to extend: [`DECISIONS.md`](DECISIONS.md)

## Run it

Requires Node 26 (LTS).

```bash
nvm use
```

```bash
npm ci
```

```bash
npm test
```

`npm test` runs `tsc --noEmit` and then `vitest run --typecheck`. That covers the runtime tests and the type-level tests (`*.test-d.ts`). CI runs the same command on every push and pull request.

No server or real integrations are needed. Pricing, the breach reporter and the clock are injected, signing keys are generated per test run, and HTTP tests use Fastify's `inject()`.

## What the tests prove

| Layer | Proof |
|---|---|
| Types | `OfferFor<'tenant0'>` is exactly `BaselineOffer`. Putting a Switchback-exclusive offer into a tenant-0 list does not compile. |
| Context | A `TenantContext` cannot be constructed or faked outside the identity layer, at compile time or at runtime. |
| Architecture | Only `src/lib/identity/**` imports `mintTenantContext`. |
| Pipeline | Eligibility runs before pricing. Pricing can set a rate but cannot add an offer. Missing or expired quotes are dropped. |
| Gate | Anything the tenant is not entitled to is dropped and reported, baseline offers are kept, and a forged context throws. |
| Identity | Only RS256 tokens from a known issuer with the right audience, an `exp` and a `sub` are accepted. The tenant comes from the issuer, not a claim. |
| HTTP | Tenant 0 never sees an exclusive offer. The service returns 401 without a token, 503 when pricing is down, and a generic 500 on a forged context. |

## Layout

```
src/
  lib/
    tenancy/       TenantId, TenantContext (capability token), mint
    identity/      Authenticator interface + jose JWT implementation (sole minter)
    offers/        offer types, catalog, isolation gate, getOffers pipeline
    pricing/       PricingClient contract (Supply squad)
    observability/ BreachReporter
  server/          Fastify app, identity hook, GET /offers
test/
  architecture.test.ts
  helpers/         fixed clock, test issuers and token signing
```
