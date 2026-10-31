# Decisions — tenant-isolation guardrail

## Key decisions

- **Capability token, not a runtime check.** Only the identity layer can create a `TenantContext<T>`. It is a class with an ES `#private` brand and a constructor guarded by a module-private symbol. An object literal that looks like a context fails both `tsc` and `isTenantContext`. An architecture test keeps `mintTenantContext` inside `src/lib/identity/**`.
- **Illegal states are unrepresentable.** `ExclusiveOffer<T>` resolves to `never` for tenants with no exclusive offers, so `OfferFor<'tenant0'>` *is* `BaselineOffer`. Type-level tests (`@ts-expect-error`, `expectTypeOf`) fail if that ever stops being true.
- **The tenant comes from the issuer.** The issuer whose key verified the token decides the tenant. A `tenant` claim may only agree with it. Algorithms are pinned to RS256, so `none` and HS256 tokens are rejected. Issuer, audience, `exp` and `sub` are required. jose does not require `exp` by default, so without that rule a non-expiring token would be accepted.
- **The pricing join runs over the selected offers.** Pricing can set a rate but can never add an offer. Missing quotes and quotes expiring at or before `now` are dropped, so an unverified or stale rate is never shown.
- **The gate drops and reports, but throws on a forged context.** A wrong-tenant or unknown-scope offer is removed and a `TenantIsolationBreach` is sent to the reporter (Sev-1 page in production), while the user still gets their baseline offers. A forged context means the trust root was bypassed, so the gate throws and the API returns a generic 500 with no offers.
- **Stack.** Fastify rather than Next.js: this is a headless service, and Next.js requires React. `jose` rather than `jsonwebtoken`: TypeScript-native, Web Crypto based, and it takes an injected clock. Node 26 (current LTS), TypeScript 7 and Vitest 5. `skipLibCheck` is on because a transitive Fastify dependency (`thread-stream`) has types that fail under current `@types/node`.

| Element | Pattern |
|---|---|
| `TenantContext` minted only by identity | Capability token |
| `ExclusiveOffer<'tenant0'>` is `never` | Phantom types; illegal states unrepresentable |
| Identity turns claims into a context once | Parse, don't validate |
| `getOffers` fixed step order | Template Method |
| `BreachReporter` | Observer |
| `Authenticator` | Strategy |
| Output gate | Fail-closed policy enforcement point |

## Proof that a breach fails loudly

Each layer was broken on purpose, and the corresponding test went red. The excerpts below are from those runs.

**The gate allows everything** (`const entitled = true`):

```
FAIL  src/lib/offers/gate.test.ts > enforceTenantIsolation > BREACH: drops a Switchback-exclusive offer for a tenant0 user and keeps baseline
AssertionError: expected [ 'hysa-baseline', …(1) ] to deeply equal [ 'hysa-baseline' ]
  [
    "hysa-baseline",
+   "hysa-switchback-plus",
  ]
```

**The join runs over the quotes instead of the selected offers.** The gate still caught the leak (defense in depth), and the test failed because the join should have stopped it first:

```
FAIL  src/lib/offers/get-offers.test.ts > getOffers > pricing cannot add an offer: rogue quotes for exclusive ids are ignored for tenant0
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 2 times
    "offerId": "hysa-switchback-plus",
    "offerScope": { "kind": "exclusive", "tenant": "switchback" }
```

Other checks: the tenant-0 catalog returning exclusive offers turns the catalog test red. Making `ExclusiveOffer` unconditional turns two type tests red. Importing the mint outside identity turns the architecture test red. Disabling the gate's context check turns the forged-context HTTP test from 500 into 200.

## Harden next

- **Tenant-keyed cache.** A `cacheKey(ctx: TenantContext<T>, …)` that cannot be called without a context, so no untenanted cache entry can exist. This is a good first extension for Sam.
- **Full degraded mode** when pricing is slow or down: timeout budget, baseline-only fallback (Marcus).
- **JWKS fetching and key rotation** in place of static public keys.
- **Contract tests** against Supply's real pricing API.
- **An audit log** of which offers were shown to whom.
- **An adversarial and property-based isolation suite** (Dana): generate arbitrary offer lists and contexts, and assert the gate's output never contains an offer the tenant isn't entitled to.

## Extending it

- **Add a tenant.** Add it to `TenantId` in `src/lib/tenancy/tenant.ts`. `tsc` then fails at `catalogFor`'s `assertNever` until the tenant is handled. Add its `IssuerConfig`, and add the catalog and type tests first.
- **Add an exclusive offer.** Append it to that tenant's exclusive array in `src/lib/offers/catalog.ts`. The uniqueness test and the type tests already cover it. Add a catalog test that names the new id.
- **Add an auth scheme.** Implement `Authenticator` inside `src/lib/identity/`. That is the only place the architecture test lets you mint a context.
