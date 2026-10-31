# Tenant-Isolation Guardrail — Design Spec

**Date:** 2026-10-31
**Status:** Approved in brainstorming, pending written-spec review
**Context:** Engineering Manager take-home case study, Part 2 (hands-on build). The offers service serves tenant 0 (our own members) and Switchback. Switchback-exclusive offers carry negotiated, money-touching rates and must never reach a tenant-0 user or leak across tenants.

## 1. Goal and success criteria

Build a small, runnable TypeScript slice of the offers service in which tenant isolation is **enforced structurally**, with tests written first (TDD, red → green → refactor).

Done means:

1. A tenant context can only be created by the identity layer, both at compile time and at runtime.
2. The type system cannot express "a tenant-0 offer list containing a Switchback-exclusive offer"; type-level tests prove the compiler rejects it.
3. A fail-closed output gate removes any offer the tenant is not entitled to, keeps entitled baseline offers, and reports the breach.
4. A CI-runnable test suite fails loudly (with the leaked offer id in the message) if the guardrail is removed or weakened.
5. One real HTTP request, run in-process via `fastify.inject()`, exercises token → context → offers → gate end to end.

## 2. Assumptions

Carried from the case-study write-up:

- **Trust root.** The identity layer is the only code that can mint a tenant context. The guarantee is only as strong as its verification.
- **Tenant derivation.** Tenant comes from verified token data, never from a client header or a gateway-set field alone.
- **Gateway is not the boundary.** The service treats every request as untrusted.
- **Closed tenant set.** `tenant0 | switchback`, a closed union. Adding a tenant is a deliberate change the compiler forces through every exhaustive switch.
- **Static exclusives.** Exclusive offers are defined in code owned by this team, each tagged to exactly one tenant.
- **Pricing is downstream of isolation.** Eligibility is decided first; pricing can set a rate but can never add an offer.
- **Defense in depth.** Types are erased at runtime, so a runtime output gate is the second layer.
- **Tenant-0 continuity.** Tenant-0 baseline behaviour is unchanged.

Added during design:

- **Tenant 0 also authenticates with a JWT** (from our own issuer) in this slice, so there is one verification path. Identity sits behind an `Authenticator` interface so other schemes can be added later.
- **Unpriced or expired-quote offers are omitted.** Full degraded mode is a separate piece (owned by Marcus) and out of scope; this slice never shows an unverified or stale rate.

## 3. Stack

- TypeScript (strict), Node 22, ESM (`"type": "module"`).
- **Fastify** for the HTTP layer (the case study's stack for services; no UI, so no Next.js/React).
- **`jose`** for JWT verification (TypeScript-native, Web Crypto, supports pinned algorithms, issuer, audience and an injected `currentDate`).
- **Vitest** for runtime tests and type-level tests (`expectTypeOf`, `@ts-expect-error`, `--typecheck`).
- Pricing client, reporter and clock are injected; tests mock them. No running server.

## 4. Design approach

**Capability token + tenant-parameterised types + fail-closed gate.** Rejected alternatives: per-tenant provider registry (isolation depends on which module you call; nothing stops calling the wrong one) and a runtime filter alone (the "hopeful runtime check" the brief rules out).

Pattern vocabulary:

| Element | Pattern / technique |
|---|---|
| `TenantContext` mintable only by identity | Capability token (object-capability security) |
| `ExclusiveOffer<'tenant0'>` is `never` | Phantom/branded types; illegal states unrepresentable |
| Identity parses claims into a context once | Parse, don't validate |
| `getOffers` fixed step order | Template Method (function with injected steps) |
| `BreachReporter` | Observer |
| `Authenticator` interface | Strategy |
| Output gate | Policy enforcement point, fail-closed |

## 5. Structure

```
src/
  server/
    app.ts                     buildApp(deps): FastifyInstance (no listen)
    plugins/identity.ts        onRequest hook: Authenticator -> request.tenantContext, else 401
    routes/offers.ts           GET /offers -> getOffers(request.tenantContext, deps)
  lib/
    tenancy/
      tenant.ts                TenantId, ExclusiveTenant, assertNever
      context.ts               TenantContext<T>, mintTenantContext, isTenantContext
    identity/
      authenticator.ts         Authenticator interface
      jwt-authenticator.ts     jose-based implementation (sole importer of mintTenantContext)
    offers/
      types.ts                 OfferScope, BaselineOffer, ExclusiveOffer<T>, OfferFor<T>, PricedOffer<T>
      catalog.ts               static definitions; catalogFor(ctx)
      gate.ts                  enforceTenantIsolation(ctx, offers, reporter)
      get-offers.ts            pipeline + response shape
    pricing/
      client.ts                PricingClient interface, Quote
    observability/
      breach.ts                BreachReporter, TenantIsolationBreach
test/
  architecture.test.ts
  helpers/                     test key pairs, token factory, fixtures
.github/workflows/ci.yml
```

Tests sit next to the code they test (`*.test.ts` for runtime tests, `*.test-d.ts` for type tests).

## 6. Components

### 6.1 Tenancy

```ts
type TenantId = 'tenant0' | 'switchback'
type ExclusiveTenant = 'switchback'           // tenants that have exclusive offers
function assertNever(x: never): never
```

`TenantContext<T extends TenantId>` is a class with an ES `#tenant` private field and the user's verified `userId` and `signals` (tenure in months, region). Its constructor requires a module-private `unique symbol` token; calling it without the token throws. `mintTenantContext(tenant, userId, signals)` is exported for the identity layer only, and an architecture test enforces that. `isTenantContext(x)` uses `#tenant in x`, so an object literal shaped like a context is rejected at runtime.

### 6.2 Offers and types

```ts
type OfferScope = { kind: 'baseline' } | { kind: 'exclusive'; tenant: ExclusiveTenant }
type BaselineOffer = { id: string; product: 'hysa' | 'ewa'; scope: { kind: 'baseline' }; eligible(s: Signals): boolean }
type ExclusiveOffer<T extends TenantId> =
  T extends ExclusiveTenant
    ? { id: string; product: 'hysa' | 'ewa'; scope: { kind: 'exclusive'; tenant: T }; eligible(s: Signals): boolean }
    : never
type PricedOffer<T extends TenantId> = OfferFor<T> & { rate: Quote['rate']; expiresAt: Date }
type OfferFor<T extends TenantId> = BaselineOffer | ExclusiveOffer<T>
```

`OfferFor<'tenant0'>` therefore reduces to `BaselineOffer`. Every offer carries a runtime `scope` tag because types do not exist at runtime.

`catalogFor<T>(ctx: TenantContext<T>): OfferFor<T>[]` switches exhaustively on the tenant (`assertNever` in the default branch) and returns baseline offers plus that tenant's exclusive offers.

### 6.3 Pricing

```ts
type Quote = { offerId: string; rate: { apy: number } | { feeCents: number }; expiresAt: Date }
interface PricingClient { quote(tenant: TenantId, offerIds: string[]): Promise<Quote[]> }
```

Supply owns the real implementation; this slice defines the contract and mocks it.

### 6.4 Gate

`enforceTenantIsolation<T>(ctx, offers, reporter): PricedOffer<T>[]`

- If `!isTenantContext(ctx)`: **throw**. The trust root was bypassed, so even baseline offers must not be returned.
- For each offer: keep it if `scope.kind === 'baseline'`, or if `scope.kind === 'exclusive' && scope.tenant === ctx.tenant`.
- Otherwise, including an unknown `scope.kind`, drop the offer and call `reporter.report({ requestTenant, offerId, offerScope })`.
- Baseline offers the tenant is entitled to are always returned.

### 6.5 Observability

```ts
type TenantIsolationBreach = { requestTenant: TenantId; offerId: string; offerScope: unknown }
interface BreachReporter { report(e: TenantIsolationBreach): void }
```

In production this would be a New Relic custom event with an alert that pages Sev-1 through Rootly. In tests it is a spy.

### 6.6 Identity

```ts
interface Authenticator {
  authenticate(req: { headers: Record<string, string | undefined> }): Promise<TenantContext<TenantId> | null>
}
```

`JwtAuthenticator` is configured with an issuer map of `issuer → { publicKey, tenant, audience }`, plus a clock.

- Reads `Authorization: Bearer <jwt>`.
- Decodes the unverified `iss` only to choose a key. An unknown issuer gives `null`.
- Calls `jwtVerify` with `algorithms: ['RS256']`, that issuer, that audience, and `currentDate` from the clock.
- **The tenant is the issuer's configured tenant.** If a `tenant` claim is present and does not match, the result is `null`.
- Requires `sub` (userId). Signals come from verified claims with safe defaults.
- Any error gives `null`. It never throws to the caller.

### 6.7 Pipeline (`getOffers`)

`getOffers(ctx, { pricing, reporter, now })` runs a fixed order:

1. `catalogFor(ctx)`
2. Filter by `offer.eligible(ctx.signals)`
3. `pricing.quote(ctx.tenant, eligibleIds)`, then join the quotes **onto the selected offers by id**. Quotes for ids we did not request are ignored. Offers with no quote, or with `expiresAt <= now()`, are omitted.
4. `enforceTenantIsolation(ctx, priced, reporter)`
5. Build the response.

Response:

```json
{
  "generatedAt": "<ISO, from now()>",
  "count": 2,
  "offers": [
    { "id": "...", "product": "hysa", "kind": "baseline", "rate": { "apy": 4.1 }, "expiresAt": "<ISO quote expiry>" }
  ]
}
```

`count` is the number of offers left **after** the gate.

### 6.8 HTTP

- `buildApp({ authenticator, pricing, reporter, now })` registers the identity plugin and the offers route, and does not listen.
- The identity hook sets `request.tenantContext` or replies `401 { error: 'unauthorized' }`, with no reason detail.
- The route serializes the `getOffers` result as JSON.

## 7. Error handling

| Situation | Behaviour |
|---|---|
| Missing, invalid, expired or tampered token; unknown issuer; tenant mismatch | 401, no detail |
| Forged or absent context reaching the gate | Throw; Fastify returns 500 and no offers leave the service |
| Exclusive offer for the wrong tenant, or unknown scope | Dropped, reported; the rest of the response is returned |
| Missing or expired quote | Offer omitted |
| Pricing call throws | 503, no offers. A full fallback is degraded mode, out of scope |

## 8. Test plan (TDD order)

Each row is one red → green → refactor cycle. The test is written and seen to fail before any code is written.

| # | Layer | Test |
|---|---|---|
| 1 | tenancy | `TenantContext` cannot be constructed without the token; a `{tenant:'switchback'}` literal fails `isTenantContext` |
| 2 | types | `OfferFor<'tenant0'>` equals `BaselineOffer`; `@ts-expect-error` on assigning a Switchback exclusive to `OfferFor<'tenant0'>[]` |
| 3 | catalog | `catalogFor(tenant0)` has no exclusive offers; `catalogFor(switchback)` includes them; type test on the return type |
| 4 | **gate** | **Headline breach test:** a Switchback exclusive with a tenant-0 context is dropped, baseline is kept, and the reporter is called once with details |
| 5 | gate | Unknown `scope.kind` is dropped and reported |
| 6 | gate | A forged context throws |
| 7 | gate | A Switchback exclusive with a Switchback context passes with no report |
| 8 | pipeline | A rogue pricing mock quoting exclusive ids on a tenant-0 request does not add them; pricing receives eligible ids only |
| 9 | pipeline | Ineligible offers are never priced; missing or expired quotes are omitted |
| 10 | pipeline | `generatedAt` comes from the clock; `count` equals the post-gate length; every offer has `expiresAt` |
| 11 | identity | A valid Switchback token gives a Switchback context, with the tenant taken from the issuer |
| 12 | identity | `null` for a missing token, expired token, bad signature, `tenant` claim mismatch, unknown issuer, `alg: none`, HS256 |
| 13 | http | `inject`: tenant-0 token → 200 with no exclusive; Switchback token → exclusive present; no token → 401 |
| 14 | arch | Only `src/lib/identity/**` imports `mintTenantContext` |

**CI:** `npm test` runs `tsc --noEmit && vitest run --typecheck`. GitHub Actions runs it on push and pull request.

**Loud-failure proof:** the decisions note records the result of deleting the gate's filter. Tests 4 and 8 fail and name the leaked offer id.

## 9. Out of scope / harden next

- Tenant-keyed cache, where a cache key cannot be built without a `TenantContext` (extension task for Sam).
- Full degraded mode when pricing is slow or down (Marcus).
- JWKS fetching and key rotation in place of static public keys.
- Contract tests against Supply's real pricing API.
- An audit log of which offers were shown to whom.
- An adversarial and property-based isolation suite (Dana).

## 10. Deliverables

- The code and tests above.
- `DECISIONS.md`: key decisions, harden-next items, and how a teammate extends the slice (adding a tenant, adding an exclusive offer).
- `README.md`: setup and `npm test`.
